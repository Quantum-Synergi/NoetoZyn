import http from 'http';
import { fileURLToPath } from 'url';
import { clusterApiUrl, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import { generateSlotSeededTelemetry, maskTelemetry } from './telemetry_bridge.js';

const PORT = Number(process.env.PORT || 3000);
const RPC_ENDPOINT = process.env.NOETOZYN_RPC || clusterApiUrl('devnet');
const PROGRAM_ID = process.env.NOETOZYN_PROGRAM_ID || null;
const COPILOT_API_BASE = process.env.COLOSSEUM_COPILOT_API_BASE || 'https://copilot.colosseum.com/api/v1';
const COPILOT_PAT = process.env.COLOSSEUM_COPILOT_PAT;
const connection = new Connection(RPC_ENDPOINT, 'confirmed');
const COOLDOWN_MS = 20_000;
const cooldowns = new Map();

function jsonResponse(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
function anchorDiscriminator(name) { return crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8); }
function loadGuardian() {
  const path = `${os.homedir()}/.config/solana/id.json`;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, 'utf8'))));
}
function configuredProgram() {
  if (!PROGRAM_ID) throw new Error('NOETOZYN_PROGRAM_ID is not configured');
  return new PublicKey(PROGRAM_ID);
}
function deriveCheckpoint(program, guardian, streamId) {
  return PublicKey.findProgramAddressSync([Buffer.from('biometric_proof'), guardian.toBuffer(), streamId], program)[0];
}
function decodeCheckpoint(pubkey, accountData) {
  const data = Buffer.from(accountData);
  if (data.length < 97) throw new Error('ProofCheckpoint data is truncated');
  return {
    pda: pubkey.toBase58(),
    guardianWallet: new PublicKey(data.subarray(8, 40)).toBase58(),
    telemetryStreamId: data.subarray(40, 56).toString('hex'),
    maskedStateHash: data.subarray(56, 88).toString('hex'),
    timestamp: data.readBigInt64LE(88).toString(),
    isActiveShield: Boolean(data[96]),
  };
}
async function findCheckpoint(program, guardian) {
  const accounts = await connection.getProgramAccounts(program, { commitment: 'confirmed', filters: [{ dataSize: 97 }] });
  const match = accounts.find(({ account }) => new PublicKey(account.data.subarray(8, 40)).equals(guardian));
  if (!match) throw new Error('ProofCheckpoint account not found');
  return decodeCheckpoint(new PublicKey(match.pubkey), match.account.data);
}
function buildCommitInstruction(program, guardian, checkpoint, streamId, hash, timestamp) {
  const timestampData = Buffer.alloc(8);
  timestampData.writeBigInt64LE(BigInt(timestamp));
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: checkpoint, isSigner: false, isWritable: true },
      { pubkey: guardian.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([anchorDiscriminator('commit_biometric_proof'), streamId, hash, timestampData]),
  });
}
function buildBreakerInstruction(program, guardian, checkpoint) {
  return new TransactionInstruction({
    programId: program,
    keys: [{ pubkey: checkpoint, isSigner: false, isWritable: true }, { pubkey: guardian.publicKey, isSigner: true, isWritable: false }],
    data: anchorDiscriminator('trigger_circuit_breaker'),
  });
}
export function cooldownRemaining(name, now = Date.now()) { return Math.max(0, (cooldowns.get(name) || 0) - now); }
export function enforceCooldown(name, durationMs = COOLDOWN_MS) {
  const remaining = cooldownRemaining(name);
  if (remaining > 0) {
    const error = new Error(`Cooldown active; retry in ${Math.ceil(remaining / 1000)} seconds`);
    error.statusCode = 429;
    error.retryAfterSeconds = Math.ceil(remaining / 1000);
    throw error;
  }
  cooldowns.set(name, Date.now() + durationMs);
}
async function readChainState() {
  if (!PROGRAM_ID) return { reachable: false, mode: 'MOCK', error: 'NOETOZYN_PROGRAM_ID is not configured' };
  try {
    const program = configuredProgram();
    const slot = await connection.getSlot('confirmed');
    const account = await connection.getAccountInfo(program, 'confirmed');
    return { reachable: true, mode: account?.executable ? 'LIVE' : 'MOCK', programId: program.toBase58(), programExecutable: Boolean(account?.executable), slot, blockTime: await connection.getBlockTime(slot) };
  } catch (error) {
    return { reachable: false, mode: 'MOCK', error: `Solana RPC unavailable: ${error.message}` };
  }
}
async function readTelemetry() {
  try {
    const slot = await connection.getSlot('confirmed');
    const telemetry = generateSlotSeededTelemetry(slot);
    const masked = maskTelemetry({ ...telemetry, slot });
    return { source: 'simulated / slot-seeded', slot, heartRate: telemetry.heartRate, eeg: telemetry.eeg, maskedHeartRate: masked.maskedHeartRate, maskedStateHash: `0x${masked.maskedStateHash.slice(0, 16)}...` };
  } catch (error) {
    return { source: 'simulated / slot-seeded', error: `Telemetry slot unavailable: ${error.message}` };
  }
}
async function readCheckpoint() {
  try { const guardian = loadGuardian(); return await findCheckpoint(configuredProgram(), guardian.publicKey); }
  catch (error) { return { error: `Could not load checkpoint: ${error.message}` }; }
}
async function commitCheckpoint() {
  enforceCooldown('commit');
  const guardian = loadGuardian();
  const program = configuredProgram();
  const slot = await connection.getSlot('confirmed');
  const telemetry = generateSlotSeededTelemetry(slot);
  const masked = maskTelemetry({ ...telemetry, slot });
  const streamId = crypto.randomBytes(16);
  const checkpoint = deriveCheckpoint(program, guardian.publicKey, streamId);
  const tx = new Transaction().add(buildCommitInstruction(program, guardian, checkpoint, streamId, Buffer.from(masked.maskedStateHash, 'hex'), Math.floor(Date.now() / 1000)));
  const signature = await sendAndConfirmTransaction(connection, tx, [guardian], { commitment: 'finalized' });
  return { signature, explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`, confirmationStatus: 'finalized', simulated: { source: 'simulated / slot-seeded', heartRate: telemetry.heartRate, eeg: telemetry.eeg, maskedHeartRate: masked.maskedHeartRate, slot } };
}
async function triggerCircuitBreaker() {
  enforceCooldown('circuit-breaker');
  const guardian = loadGuardian();
  const program = configuredProgram();
  const checkpoint = await findCheckpoint(program, guardian.publicKey);
  if (!checkpoint.isActiveShield) throw new Error('Circuit breaker is already inactive; the deployed instruction is one-way');
  const tx = new Transaction().add(buildBreakerInstruction(program, guardian, new PublicKey(checkpoint.pda)));
  const signature = await sendAndConfirmTransaction(connection, tx, [guardian], { commitment: 'finalized' });
  return { previousState: true, newState: false, signature, explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet` };
}
async function readCopilot() {
  if (!COPILOT_PAT) return { configured: false, error: 'Copilot credentials are not configured' };
  try {
    const response = await fetch(`${COPILOT_API_BASE}/search/projects`, { method: 'POST', headers: { Authorization: `Bearer ${COPILOT_PAT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'privacy-preserving biometric telemetry at the edge', limit: 5, includeFacets: false }) });
    if (!response.ok) return { configured: true, status: 'unavailable', httpStatus: response.status };
    const search = await response.json();
    return { configured: true, status: 'authenticated', totalFound: search.totalFound, results: (search.results || []).map(({ name, similarity, oneLiner }) => ({ name, similarity, oneLiner })) };
  } catch (error) { return { configured: true, status: 'unavailable', error: `Copilot unavailable: ${error.message}` }; }
}

function dashboardPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>NoetoZyn Live Dashboard</title>
<style>
:root{font-family:Inter,system-ui,sans-serif;color:#1F1E1B;background:#fff}body{max-width:980px;margin:auto;padding:26px;background:#fff}h1{margin:0 0 4px;font-size:28px}h2{margin:0 0 8px;font-size:14px}.subtitle{color:#6B6A65;margin:0 0 18px}.header{display:flex;justify-content:space-between;gap:16px;align-items:start}.header-actions{display:flex;gap:8px;flex-wrap:wrap}.nz-blue{color:#0C447C}.nz-coral{color:#712B13}:root{--nz-blue:#378ADD;--nz-blue-bg:#E6F1FB;--nz-blue-text:#0C447C;--nz-coral:#D85A30;--nz-coral-bg:#FAECE7;--nz-coral-text:#712B13;--nz-surface:#F5F4F0;--nz-border:#E3E1D9;--nz-text:#1F1E1B;--nz-text-secondary:#6B6A65;--nz-text-muted:#9B9A93;--nz-radius:10px;--nz-radius-lg:12px}.nz-panel{border-radius:var(--nz-radius-lg);padding:16px;margin-bottom:20px}.nz-panel-blue{border:2px solid var(--nz-blue)}.nz-panel-coral{border:2px dashed var(--nz-coral)}.nz-panel-neutral{border:1px solid var(--nz-border)}.nz-panel-title{margin:0 0 8px;font-weight:600;font-size:14px;color:var(--nz-text)}.nz-panel-sub{margin:0 0 10px;font-size:13px;color:var(--nz-text-secondary)}.nz-badge-blue{display:inline-block;font-size:12px;padding:3px 10px;border-radius:12px;background:var(--nz-blue-bg);color:var(--nz-blue-text)}.nz-badge-coral{display:inline-block;font-size:11px;padding:2px 8px;border-radius:10px;background:var(--nz-coral-bg);color:var(--nz-coral-text)}.nz-disclosure{background:var(--nz-surface);border-radius:var(--nz-radius);padding:12px 14px;font-size:13px;color:var(--nz-text-secondary);line-height:1.6;margin-bottom:20px}.nz-field-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;font-size:13px}.nz-field-label{color:var(--nz-text-secondary);display:block;margin-bottom:2px}.nz-mono{font-family:monospace;overflow-wrap:anywhere}.nz-btn{border:1px solid var(--nz-border);background:#fff;border-radius:var(--nz-radius);padding:8px 14px;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}.nz-btn:hover{background:var(--nz-surface)}.nz-btn:disabled{opacity:.5;cursor:not-allowed}.nz-btn-icon{width:16px;height:16px;flex-shrink:0}.nz-stepper{display:flex;align-items:center;margin-bottom:28px}.nz-step{flex:1;text-align:center;padding:12px 6px;border-radius:var(--nz-radius-lg);background:var(--nz-surface);color:var(--nz-text-muted);transition:background .2s,color .2s}.nz-step.active{background:var(--nz-blue-bg);color:var(--nz-blue-text)}.nz-step-icon{width:20px;height:20px;display:block;margin:0 auto 4px}.nz-step-label{font-size:13px}.nz-step-arrow{flex-shrink:0;padding:0 4px;color:var(--nz-text-muted);width:20px;height:20px}.nz-compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px}.nz-compare-box{background:var(--nz-surface);border-radius:var(--nz-radius);padding:10px 12px}.nz-compare-label{font-size:12px;color:var(--nz-text-secondary);margin:0 0 4px}.nz-compare-value{font-size:13px;color:var(--nz-text-muted);margin:0}.status{min-height:20px;margin:10px 0 0;font-size:13px}.error{color:var(--nz-coral-text)}.success{color:#286b45}.muted{color:var(--nz-text-muted)}.timeline{margin:0;padding-left:18px;font-size:13px}.qr{max-width:180px;border:1px solid var(--nz-border);padding:8px;margin-top:10px}.table{width:100%;border-collapse:collapse;font-size:13px}.table th,.table td{text-align:left;padding:7px;border-bottom:1px solid var(--nz-border);vertical-align:top}footer{font-size:12px;color:var(--nz-text-muted);border-top:1px solid var(--nz-border);padding-top:16px;margin-top:24px}@media(max-width:620px){body{padding:16px}.header{display:block}.header-actions{margin-top:12px}.nz-step-label{font-size:11px}.nz-stepper{gap:2px}.nz-step-arrow{width:13px;padding:0}.nz-compare-grid{grid-template-columns:1fr}}
/* Dark dashboard contrast overrides. */
:root{color:#F2F4F5;background:#080A0D;--nz-blue-bg:#10283D;--nz-blue-text:#A9D9FF;--nz-coral-bg:#3A1C16;--nz-coral-text:#FFB19D;--nz-surface:#171B20;--nz-border:#303840;--nz-text:#F2F4F5;--nz-text-secondary:#AAB3BC;--nz-text-muted:#7F8A95}
body{background:#080A0D;color:#F2F4F5}.subtitle{color:#AAB3BC}.nz-blue{color:#8CCBFF}.nz-coral{color:#FF9B82}.nz-panel,.nz-panel-blue,.nz-panel-coral,.nz-panel-neutral{background:#11151A}.nz-btn{background:#171B20;color:#F2F4F5;border-color:#303840}.nz-btn:hover{background:#20262D}.success{color:#8FD6A8}
/* Activity timeline */
.nz-timeline-panel{background:var(--nz-surface,#171B20);border:1px solid var(--nz-blue-bg,#10283D);border-radius:12px;padding:1rem 1.25rem}.nz-timeline-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.nz-timeline-badge{font-size:12px;color:var(--nz-blue-text,#A9D9FF);background:var(--nz-blue-bg,#10283D);padding:2px 10px;border-radius:6px}.nz-timeline-list{max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:2px}.nz-timeline-row{display:flex;gap:10px;padding:8px 4px;border-bottom:1px solid var(--nz-border,#303840)}.nz-timeline-row:last-child{border-bottom:none}.nz-timeline-row .icon{font-size:18px;margin-top:2px;flex-shrink:0}.nz-timeline-title{font-size:13px;color:var(--nz-text,#F2F4F5)}.nz-timeline-meta{font-size:12px;color:var(--nz-text-muted,#7F8A95)}.nz-timeline-row.capture .icon,.nz-timeline-row.commit-submitted .icon{color:#8CCBFF}.nz-timeline-row.commit-confirmed .icon,.nz-timeline-row.verification-confirmed .icon{color:var(--success,#8FD6A8)}.nz-timeline-row.error .icon{color:#FF9B82}.nz-timeline-row.background .icon{color:#AAB3BC}
.nz-timeline-row .icon svg{width:18px;height:18px;display:block}
</style></head><body>
<header class="header"><div><h1>NoetoZyn</h1></div><div class="header-actions"><button class="nz-btn" id="plain-toggle">Plain-language view</button><span class="nz-badge-blue" id="network-badge">Checking RPC...</span></div></header>
<div class="nz-disclosure">This dashboard uses simulated / slot-seeded telemetry, not a medical device or real sensor. Uploaded CSV data stays in this browser and is never sent, logged, or persisted. Blockchain writes are irreversible. No seed phrase or private key is entered here; real write actions use the server-side demo guardian only.</div>
<section class="nz-panel nz-panel-neutral"><h2 class="nz-panel-title">Optional: connect your Solana wallet</h2><p class="nz-panel-sub">Wallet connection is not required. This display is identity-only and never signs, uploads, or changes the server-side guardian.</p><button class="nz-btn" id="wallet-button">Connect wallet</button><span class="muted" id="wallet-state" aria-live="polite">Disconnected</span></section>
<section class="nz-panel nz-panel-blue"><h2 class="nz-panel-title">Chain status <span class="nz-badge-blue">real · on-chain</span></h2><div class="nz-field-grid" id="chain-fields"><div><span class="nz-field-label">Program ID</span><span class="nz-mono" id="program-id">loading...</span></div><div><span class="nz-field-label">Cluster</span><span>devnet</span></div><div><span class="nz-field-label">Slot</span><span id="slot">loading...</span></div><div><span class="nz-field-label">Block time</span><span id="block-time">loading...</span></div><div><span class="nz-field-label">Executable / mode</span><span id="mode">loading...</span></div></div><p class="status" id="chain-status" aria-live="polite"></p></section>
<div class="nz-stepper"><div class="nz-step active" data-step="capture"><svg class="nz-step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 12 8 12 10 18 14 6 16 12 21 12"/></svg><span class="nz-step-label">1. Capture</span></div><svg class="nz-step-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg><div class="nz-step" data-step="mask"><svg class="nz-step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><span class="nz-step-label">2. Mask</span></div><svg class="nz-step-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg><div class="nz-step" data-step="commit"><svg class="nz-step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 15L15 9"/><path d="M7 12a4 4 0 0 1 0-6l2-2a4 4 0 0 1 6 6"/><path d="M17 12a4 4 0 0 1 0 6l-2 2a4 4 0 0 1-6-6"/></svg><span class="nz-step-label">3. Commit</span></div><svg class="nz-step-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg><div class="nz-step" data-step="verify"><svg class="nz-step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/></svg><span class="nz-step-label">4. Verify</span></div><svg class="nz-step-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg><div class="nz-step" data-step="proof"><svg class="nz-step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 15l2 2 4-4"/></svg><span class="nz-step-label">5. Take proof</span></div></div>
<section class="nz-panel nz-panel-coral"><h2 class="nz-panel-title">Simulated / slot-seeded telemetry <span class="nz-badge-coral">fabricated · not sensor data</span></h2><p class="nz-panel-sub">A deterministic demo reading generated from the current Solana slot.</p><div class="nz-field-grid"><div><span class="nz-field-label">Raw heart rate</span><strong id="raw-hr">--</strong> bpm</div><div><span class="nz-field-label">Raw EEG</span><strong id="raw-eeg">--</strong> μV</div><div><span class="nz-field-label">Masked heart rate</span><strong id="masked-hr">--</strong> bpm</div><div><span class="nz-field-label">Hash preview</span><span class="nz-mono" id="hash-preview">--</span></div></div><button class="nz-btn" id="capture-button" style="margin-top:14px">Run simulated capture</button><p class="status" id="telemetry-status" aria-live="polite"></p></section>
<section class="nz-panel nz-panel-blue"><h2 class="nz-panel-title">Commit simulated devnet checkpoint <span class="nz-badge-blue">real write</span></h2><p class="nz-panel-sub">Uses one fresh server-side slot-seeded capture. No telemetry values are accepted from the browser.</p><button class="nz-btn" id="commit-button" disabled>Commit this checkpoint</button><p class="status" id="commit-status" aria-live="polite">Run a simulated capture first.</p></section>
<section class="nz-panel nz-panel-blue"><h2 class="nz-panel-title">Proof checkpoint viewer <span class="nz-badge-blue">real · decoded</span></h2><button class="nz-btn" id="checkpoint-button">Refresh on-chain state</button><div class="nz-field-grid" style="margin-top:14px"><div><span class="nz-field-label">PDA</span><span class="nz-mono" id="proof-pda">--</span></div><div><span class="nz-field-label">Guardian</span><span class="nz-mono" id="proof-guardian">--</span></div><div><span class="nz-field-label">Stream ID</span><span class="nz-mono" id="proof-stream">--</span></div><div><span class="nz-field-label">Masked hash</span><span class="nz-mono" id="proof-hash">--</span></div><div><span class="nz-field-label">Shield active</span><span id="proof-shield">--</span></div><div><span class="nz-field-label">Timestamp</span><span id="proof-time">--</span></div></div><p class="status" id="checkpoint-status" aria-live="polite"></p></section>
<section class="nz-panel nz-panel-coral"><h2 class="nz-panel-title">Create local proof receipt</h2><p class="nz-panel-sub">Create a browser-only proof artifact. Nothing is uploaded.</p><button class="nz-btn" id="download-proof">Download local report (.json)</button><button class="nz-btn" id="show-qr">Show Proof QR</button><div id="qr-output"></div><p class="status" id="proof-status" aria-live="polite">Mobile: use Share, then Save to Files.</p></section>
<hr>
<section><h2>Try it with your own data</h2><p class="subtitle">Optional CSV processing stays entirely in this browser. Expected columns: heartRate,eeg.</p><section class="nz-panel nz-panel-coral"><input type="file" id="csv-file" accept=".csv,text/csv"><button class="nz-btn" id="sample-button">Use sample data instead</button><p class="status" id="csv-status" aria-live="polite"></p><div class="nz-compare-grid"><div class="nz-compare-box"><p class="nz-compare-label">Raw input</p><p class="nz-compare-value" id="csv-raw">No local data loaded.</p></div><div class="nz-compare-box"><p class="nz-compare-label">Masked output</p><p class="nz-compare-value" id="csv-masked">No local data loaded.</p></div></div><p class="nz-mono" id="csv-hash">Proof hash: --</p><button class="nz-btn" id="download-report" disabled>Download Local Report</button></section><section class="nz-panel nz-panel-neutral" id="anchor-panel"><h2 class="nz-panel-title">Commit simulated devnet checkpoint</h2><p class="nz-panel-sub">I understand this is simulated / slot-seeded or locally supplied demo data, and that publishing a hash is irreversible.</p><label><input type="checkbox" id="anchor-consent"> I consent to a real devnet transaction.</label><br><button class="nz-btn" id="anchor-button" disabled>Commit simulated devnet checkpoint</button><p class="status" id="anchor-status" aria-live="polite">Requires a local hash, consent, and a completed simulated capture.</p></section></section>
<section class="nz-panel nz-panel-coral"><h2 class="nz-panel-title">Attack simulation</h2><p class="nz-panel-sub">Illustrative local-only comparison, not a security measurement.</p><button class="nz-btn" id="attack-button">Run attack simulation</button><p class="status" id="attack-status" aria-live="polite"></p></section>
<section class="nz-panel nz-panel-blue"><h2 class="nz-panel-title">Circuit breaker <span class="nz-badge-blue">one-way on-chain action</span></h2><p class="nz-panel-sub">Current state: <strong id="breaker-state">unknown</strong>. The deployed instruction can deactivate an active shield and cannot reactivate it.</p><button class="nz-btn" id="breaker-button" disabled>Deactivate active shield</button><p class="status" id="breaker-status" aria-live="polite"></p></section>
<section class="nz-panel nz-panel-blue"><h2 class="nz-panel-title">Activity timeline</h2><ol class="timeline" id="timeline"><li class="muted">No confirmed actions in this browser session.</li></ol></section>
<section class="nz-panel nz-panel-neutral"><h2 class="nz-panel-title">Live Copilot novelty check</h2><button class="nz-btn" id="copilot-button">Run live novelty check</button><div id="copilot-output" class="status" aria-live="polite">Not run.</div></section>
<footer>NoetoZyn is <strong>Quantum Synergi</strong> software — a devnet demonstration built on a simple discipline: on-chain state is only ever shown as real when RPC confirms it, and biometric data is always disclosed as simulated or slot-seeded, never presented as medical measurement.</footer>
<script>
let nzCurrentStep='capture';function nzSetStep(step){nzCurrentStep=step;document.querySelectorAll('.nz-step').forEach(el=>el.classList.toggle('active',el.dataset.step===step));}
const $=id=>document.getElementById(id);const state={capture:null,local:null,checkpoint:null,timelineEntries:[],lastCheckpointFingerprint:null};const nzSession={captured:false,masked:false,commitSubmitted:false,commitConfirmed:false,verifyRequested:false,verified:false};setupTimeline();
function status(id,text,kind=''){const el=$(id);el.textContent=text;el.className='status '+kind}function shortValue(value,start=8,end=6){const text=String(value??'');return text.length>start+end+1?text.slice(0,start)+'…'+text.slice(-end):text}function timelineIcon(type){const icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M8 12h8"/></svg>';return icon}function renderTimeline(){const list=$('timeline-list');if(!list)return;list.innerHTML=state.timelineEntries.map(entry=>'<div class="nz-timeline-row '+entry.type+'"><span class="icon">'+timelineIcon(entry.type)+'</span><div><div class="nz-timeline-title">'+entry.title+'</div><div class="nz-timeline-meta">'+entry.timestamp+' · '+entry.detail+'</div></div></div>').join('')}function addTimeline(type,title,detail){state.timelineEntries.unshift({type,title,detail,timestamp:new Date().toLocaleTimeString()});state.timelineEntries=state.timelineEntries.slice(0,50);renderTimeline()}function setupTimeline(){const timeline=$('timeline');if(!timeline)return;const panel=timeline.closest('.nz-panel');if(!panel)return;panel.className='nz-timeline-panel';panel.innerHTML='<div class="nz-timeline-header"><h2 class="nz-panel-title">Activity timeline</h2><span class="nz-timeline-badge">real · on-chain</span></div><div class="nz-timeline-list" id="timeline-list"><div class="muted">No confirmed actions in this browser session.</div></div>'}
async function call(path,options={}){const res=await fetch(path,options);const body=await res.json();if(!res.ok)throw Object.assign(new Error(body.error||'Request failed'),{body});return body}
async function refreshChain(){try{const x=await call('/api/chain');$('program-id').textContent=x.programId||'--';$('slot').textContent=x.slot||'--';$('block-time').textContent=x.blockTime?new Date(x.blockTime*1000).toLocaleString():'unavailable';$('mode').textContent=x.programExecutable?'executable · '+x.mode:(x.error||x.mode);$('network-badge').textContent=x.reachable?'RPC connected · devnet':'RPC unavailable';status('chain-status',x.error||'Live RPC state refreshed',x.error?'error':'success')}catch(e){status('chain-status',e.message,'error')}}
async function capture(){const b=$('capture-button');b.disabled=true;status('telemetry-status','Reading current confirmed slot...');try{const x=await call('/api/telemetry');if(x.error){status('telemetry-status',x.error,'error');status('commit-status','Capture failed.','error');addTimeline('error','Capture failed',x.error);return}state.capture=x;nzSession.captured=true;nzSession.masked=true;$('raw-hr').textContent=x.heartRate??'--';$('raw-eeg').textContent=x.eeg??'--';$('masked-hr').textContent=x.maskedHeartRate??'--';$('hash-preview').textContent=x.maskedStateHash??'--';$('commit-button').disabled=false;$('anchor-button').disabled=!($('anchor-consent').checked&&state.local&&state.capture);nzSetStep('mask');status('telemetry-status','Simulated capture ready; no sensor was used.','success');status('commit-status','Masked output ready. Press commit to continue.');addTimeline('capture','Simulated capture generated','slot '+x.slot+' · masked hash '+shortValue(x.maskedStateHash))}catch(e){status('telemetry-status',e.message,'error');addTimeline('error','Capture failed',e.message)}finally{b.disabled=false}}
function cooldown(button,statusId,seconds){let left=seconds;button.disabled=true;const tick=()=>{button.textContent='Wait '+left+'s';if(left<=0){clearInterval(timer);button.textContent='Commit this checkpoint';button.disabled=false;status(statusId,'Cooldown complete.')}left-=1};tick();const timer=setInterval(tick,1000)}
async function commit(){const b=$('commit-button');b.disabled=true;nzSession.commitSubmitted=true;nzSetStep('commit');addTimeline('commit-submitted','Commit transaction submitted','awaiting confirmation');status('commit-status','Submitting one real transaction...');try{const x=await call('/api/commit',{method:'POST'});nzSession.commitConfirmed=true;nzSetStep('verify');status('commit-status','Confirmed: '+shortValue(x.signature)+' · Explorer link available','success');addTimeline('commit-confirmed','Commit confirmed on-chain','tx '+shortValue(x.signature))}catch(e){const detail=e.body?.retryAfterSeconds?'retry available in '+e.body.retryAfterSeconds+'s':e.body?.error||e.message;addTimeline('error',e.body?.retryAfterSeconds?'Commit rejected — cooldown active':'Commit rejected',detail);if(e.body?.retryAfterSeconds)cooldown(b,'commit-status',e.body.retryAfterSeconds);status('commit-status',detail,'error');if(!e.body?.retryAfterSeconds)b.disabled=false}}
async function refreshCheckpoint({userInitiated=false}={}){const b=userInitiated?$('checkpoint-button'):null;if(b)b.disabled=true;status('checkpoint-status','Reading ProofCheckpoint from RPC...');try{const x=await call('/api/checkpoint');if(x.error)throw new Error(x.error);state.checkpoint=x;$('proof-pda').textContent=x.pda;$('proof-guardian').textContent=x.guardianWallet;$('proof-stream').textContent=x.telemetryStreamId;$('proof-hash').textContent='0x'+x.maskedStateHash;$('proof-shield').textContent=String(x.isActiveShield);$('proof-time').textContent=new Date(Number(x.timestamp)*1000).toLocaleString();$('breaker-state').textContent=x.isActiveShield?'active':'inactive';$('breaker-button').disabled=!x.isActiveShield;const fingerprint=x.pda+'|'+x.maskedStateHash+'|'+x.timestamp+'|'+x.isActiveShield;if(!userInitiated&&state.lastCheckpointFingerprint&&state.lastCheckpointFingerprint===fingerprint)addTimeline('background','Checkpoint refreshed (background)','no state change');state.lastCheckpointFingerprint=fingerprint;if(userInitiated&&nzSession.commitConfirmed){nzSession.verifyRequested=true;nzSession.verified=true;nzSetStep('proof');addTimeline('verification-confirmed','Checkpoint verification confirmed','guardian '+shortValue(x.guardianWallet))}status('checkpoint-status','Confirmed on-chain state refreshed.','success')}catch(e){status('checkpoint-status',e.message,'error');if(userInitiated)addTimeline('error','Checkpoint verification failed',e.message)}finally{if(b)b.disabled=false}}
function proofData(){return {network:'Solana devnet',source:'simulated / slot-seeded or local demo data',checkpoint:state.checkpoint,capture:state.capture,local:state.local,disclaimer:'Not sensor or medical data.'}}
function download(name,data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href)}
async function sha(text){const bytes=new TextEncoder().encode(text);const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function localMask(hr,eeg){const slot=state.capture?.slot??0;const maskedHeartRate=Number(hr)+(slot%2===0?2:-2);const maskedStateHash=await sha('stream-'+maskedHeartRate+'-'+eeg);return {maskedHeartRate,maskedStateHash}}
async function loadLocal(hr,eeg,label){const masked=await localMask(hr,eeg);state.local={label,raw:{heartRate:Number(hr),eeg:Number(eeg)},masked};$('csv-raw').textContent=JSON.stringify(state.local.raw);$('csv-masked').textContent=JSON.stringify(masked);$('csv-hash').textContent='Proof hash: 0x'+masked.maskedStateHash;$('download-report').disabled=false;status('csv-status','Processed locally. No server request was made.','success');$('anchor-button').disabled=!($('anchor-consent').checked&&state.capture);}
async function csvFile(event){const file=event.target.files[0];if(!file)return;try{const rows=(await file.text()).trim().split(/\\r?\\n/);const headers=rows[0].split(',').map(x=>x.trim().toLowerCase());const values=rows[1]?.split(',').map(x=>x.trim());const hr=values?.[headers.indexOf('heartrate')];const eeg=values?.[headers.indexOf('eeg')];if(!Number.isFinite(Number(hr))||!Number.isFinite(Number(eeg)))throw new Error('CSV must contain numeric heartRate and eeg columns');await loadLocal(hr,eeg,'uploaded CSV')}catch(e){state.local=null;$('download-report').disabled=true;status('csv-status',e.message,'error')}}
async function anchor(){const b=$('anchor-button');b.disabled=true;addTimeline('commit-submitted','Anchor transaction submitted','awaiting confirmation');status('anchor-status','Submitting one real guardian-signed transaction...');try{const x=await call('/api/commit',{method:'POST'});$('anchor-panel').classList.remove('nz-panel-neutral');$('anchor-panel').classList.add('nz-panel-blue');status('anchor-status','Confirmed: '+shortValue(x.signature)+' · Explorer link available','success');addTimeline('commit-confirmed','Simulated devnet checkpoint confirmed','tx '+shortValue(x.signature))}catch(e){const detail=e.body?.retryAfterSeconds?'retry available in '+e.body.retryAfterSeconds+'s':e.body?.error||e.message;addTimeline('error','Anchor rejected',detail);status('anchor-status',detail,'error');if(e.body?.retryAfterSeconds)cooldown(b,'anchor-status',e.body.retryAfterSeconds);else b.disabled=false}}
function attack(){status('attack-status','Before: raw demo value visible locally. After: only a one-way hash is suitable for publication. Illustrative only; no attack was executed.','success')}
async function breaker(){const b=$('breaker-button');b.disabled=true;addTimeline('commit-submitted','Circuit-breaker transaction submitted','awaiting confirmation');status('breaker-status','Submitting one real one-way action...');try{const x=await call('/api/circuit-breaker',{method:'POST'});$('breaker-state').textContent='inactive';status('breaker-status','Confirmed: '+shortValue(x.signature)+' · Explorer link available','success');addTimeline('commit-confirmed','Circuit breaker confirmed on-chain','tx '+shortValue(x.signature))}catch(e){const detail=e.body?.retryAfterSeconds?'retry available in '+e.body.retryAfterSeconds+'s':e.body?.error||e.message;addTimeline('error','Circuit breaker rejected',detail);status('breaker-status',detail,'error');if(e.body?.retryAfterSeconds)cooldown(b,'breaker-status',e.body.retryAfterSeconds);else b.disabled=false}}
async function copilot(){const b=$('copilot-button');b.disabled=true;status('copilot-output','Querying live Copilot...');try{const x=await call('/api/copilot');if(x.error)throw new Error(x.error);const rows=(x.results||[]).map(r=>'<tr><td>'+String(r.name||'--')+'</td><td>'+String(r.similarity??'--')+'</td><td>'+String(r.oneLiner||'--')+'</td></tr>').join('');$('copilot-output').innerHTML='<table class="table"><tr><th>Project</th><th>Similarity</th><th>What it does</th></tr>'+rows+'</table>'}catch(e){status('copilot-output',e.message,'error')}finally{b.disabled=false}}
$('capture-button').onclick=capture;$('commit-button').onclick=commit;$('checkpoint-button').onclick=()=>refreshCheckpoint({userInitiated:true});$('download-proof').onclick=()=>download('noetozyn-proof.json',proofData());$('show-qr').onclick=()=>{$('qr-output').innerHTML='<p class="muted">QR display is unavailable without adding a dependency. Download the local JSON proof instead.</p>'};$('csv-file').onchange=csvFile;$('sample-button').onclick=()=>loadLocal(72,41,'sample data');$('download-report').onclick=()=>download('noetozyn-local-report.json',proofData());$('anchor-consent').onchange=()=>{$('anchor-button').disabled=!($('anchor-consent').checked&&state.local&&state.capture)};$('anchor-button').onclick=anchor;$('attack-button').onclick=attack;$('breaker-button').onclick=breaker;$('copilot-button').onclick=copilot;$('wallet-button').onclick=()=>status('wallet-state','Disconnected by default; no wallet provider requested.','muted');$('plain-toggle').onclick=()=>document.body.classList.toggle('plain');refreshChain();refreshCheckpoint();setInterval(refreshChain,8000);setInterval(()=>refreshCheckpoint(),10000);
</script></body></html>`;
}

async function route(request, response) {
  const path = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
  if (request.method === 'GET' && path === '/') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(dashboardPage()); return; }
  if (request.method === 'GET' && path === '/api/chain') return jsonResponse(response, 200, await readChainState());
  if (request.method === 'GET' && path === '/api/telemetry') return jsonResponse(response, 200, await readTelemetry());
  if (request.method === 'GET' && path === '/api/checkpoint') return jsonResponse(response, 200, await readCheckpoint());
  if (request.method === 'GET' && path === '/api/copilot') return jsonResponse(response, 200, await readCopilot());
  if (request.method === 'POST' && path === '/api/commit') return jsonResponse(response, 200, await commitCheckpoint());
  if (request.method === 'POST' && path === '/api/circuit-breaker') return jsonResponse(response, 200, await triggerCircuitBreaker());
  jsonResponse(response, 404, { error: 'Not found' });
}
const server = http.createServer(async (request, response) => { try { await route(request, response); } catch (error) { jsonResponse(response, error.statusCode || 500, { error: error.message || 'Dashboard request failed', ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) }); } });
if (process.argv[1] === fileURLToPath(import.meta.url)) server.listen(PORT, () => console.log(`NoetoZyn dashboard available on port ${PORT}`));
