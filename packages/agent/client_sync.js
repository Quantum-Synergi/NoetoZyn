/**
 * client_sync.js
 * Quantum Synergi - NoetoZyn Agent Core
 *
 * Bridges the edge telemetry bridge (telemetry_bridge.js) to the on-chain
 * Anchor program state (programs/noetozyn/src/lib.rs) using @solana/web3.js
 * only. No native Solana CLI / cargo-build-sbf / keygen calls are made here.
 *
 * If the configured RPC endpoint is unreachable (common in sandboxed
 * Codespace environments with restricted egress), the script drops into a
 * fully local mock-chain loop so the rest of the demo pipeline (character
 * agent + interactive UI) keeps working without a live connection.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  clusterApiUrl,
} from '@solana/web3.js';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import { generateSlotSeededTelemetry } from './telemetry_bridge.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROGRAM_ID_STR = process.env.NOETOZYN_PROGRAM_ID || 'NoetoZyn11111111111111111111111111111111111';
const RPC_ENDPOINT = process.env.NOETOZYN_RPC || clusterApiUrl('devnet');
const RPC_TIMEOUT_MS = 4000;
const POLL_INTERVAL_MS = 3000;
const COMMIT_DISCRIMINATOR = anchorDiscriminator('commit_biometric_proof');
const BREAKER_DISCRIMINATOR = anchorDiscriminator('trigger_circuit_breaker');

/**
 * Anchor instruction discriminators are sha256("global:<method_name>")
 * truncated to the first 8 bytes. We reproduce that here without pulling
 * in the full @coral-xyz/anchor client, since we only need to build raw
 * instructions.
 */
function anchorDiscriminator(methodName) {
  return crypto
    .createHash('sha256')
    .update(`global:${methodName}`)
    .digest()
    .subarray(0, 8);
}

function deriveProofCheckpointPda(programId, guardianPubkey, telemetryStreamId) {
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('biometric_proof'), guardianPubkey.toBuffer(), telemetryStreamId],
    programId
  );
  return { pda, bump };
}

function buildCommitProofInstruction({
  programId,
  guardian,
  proofCheckpointPda,
  telemetryStreamId,
  maskedStateHash,
  timestamp,
}) {
  const timestampBuf = Buffer.alloc(8);
  timestampBuf.writeBigInt64LE(BigInt(timestamp));

  const data = Buffer.concat([
    COMMIT_DISCRIMINATOR,
    telemetryStreamId, // [u8; 16]
    maskedStateHash, // [u8; 32]
    timestampBuf, // i64
  ]);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: proofCheckpointPda, isSigner: false, isWritable: true },
      { pubkey: guardian.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildTriggerBreakerInstruction({
  programId,
  proofCheckpointPda,
  guardian,
}) {
  const data = BREAKER_DISCRIMINATOR;

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: proofCheckpointPda, isSigner: false, isWritable: true },
      { pubkey: guardian.publicKey, isSigner: true, isWritable: false },
    ],
    data,
  });
}

// ---------------------------------------------------------------------------
// Telemetry -> masked state hash (mirrors telemetry_bridge.js logic)
// ---------------------------------------------------------------------------

function maskTelemetry({ heartRate, eeg }) {
  const jitter = Math.random() > 0.5 ? 2 : -2;
  const maskedHeartRate = heartRate + jitter;
  const maskedStateHash = crypto
    .createHash('sha256')
    .update(`stream-${maskedHeartRate}-${eeg}`)
    .digest();
  return { maskedHeartRate, maskedStateHash };
}

function randomStreamId() {
  return crypto.randomBytes(16);
}

function loadGuardian() {
  const keypairPath = `${os.homedir()}/.config/solana/id.json`;
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')));
  return Keypair.fromSecretKey(secretKey);
}

// ---------------------------------------------------------------------------
// Connection health check with timeout
// ---------------------------------------------------------------------------

async function probeConnection(connection) {
  try {
    const versionPromise = connection.getVersion();
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('RPC probe timed out')), RPC_TIMEOUT_MS)
    );
    await Promise.race([versionPromise, timeout]);
    return true;
  } catch (err) {
    return false;
  }
}

async function probeProgramDeployed(connection, programId) {
  try {
    const accountInfo = await connection.getAccountInfo(programId);
    return Boolean(accountInfo?.executable);
  } catch (err) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Live chain sync path
// ---------------------------------------------------------------------------

async function runLiveSync({ connection, programId, guardian }) {
  console.log('=====================================================');
  console.log(' NOETOZYN CLIENT SYNC -- LIVE RPC MODE');
  console.log(` Endpoint: ${connection.rpcEndpoint}`);
  console.log(` Program:  ${programId.toBase58()}`);
  console.log(` Guardian: ${guardian.publicKey.toBase58()}`);
  console.log('=====================================================');

  const telemetryStreamId = randomStreamId();
  const { pda: proofCheckpointPda } = deriveProofCheckpointPda(
    programId,
    guardian.publicKey,
    telemetryStreamId
  );

  console.log(` Watching checkpoint PDA: ${proofCheckpointPda.toBase58()}`);

  const subscriptionId = connection.onAccountChange(
    proofCheckpointPda,
    (accountInfo) => {
      console.log(
        `[on-chain] checkpoint account updated -- ${accountInfo.data.length} bytes, ` +
          `owner ${accountInfo.owner.toBase58()}`
      );
    },
    'confirmed'
  );

  let tick = 0;
  const interval = setInterval(async () => {
    tick += 1;
    const heartRate = 68 + Math.round(Math.random() * 20);
    const eeg = 40 + Math.random() * 15;
    const { maskedHeartRate, maskedStateHash } = maskTelemetry({ heartRate, eeg });
    const timestamp = Math.floor(Date.now() / 1000);

    console.log(
      `[edge] tick ${tick} -- raw HR ${heartRate}bpm -> masked ${maskedHeartRate}bpm, ` +
        `hash 0x${maskedStateHash.toString('hex').slice(0, 16)}...`
    );

    try {
      const ix = buildCommitProofInstruction({
        programId,
        guardian,
        proofCheckpointPda,
        telemetryStreamId,
        maskedStateHash,
        timestamp,
      });

      const tx = new Transaction().add(ix);
      tx.feePayer = guardian.publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.sign(guardian);

      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
      });
      console.log(`[chain] commit_biometric_proof sent -- sig ${sig}`);
    } catch (err) {
      console.warn(`[chain] commit failed this tick: ${err.message}`);
    }

    if (tick >= 20) {
      clearInterval(interval);
      await connection.removeAccountChangeListener(subscriptionId);
      console.log(' Live sync demo window complete (20 ticks). Exiting.');
      process.exit(0);
    }
  }, POLL_INTERVAL_MS);

  process.on('SIGINT', async () => {
    clearInterval(interval);
    await connection.removeAccountChangeListener(subscriptionId);
    console.log('\n Live sync stopped by user.');
    process.exit(0);
  });
}

async function runSingleShotSync({ connection, programId, guardian }) {
  console.log('=====================================================');
  console.log(' NOETOZYN CLIENT SYNC -- LIVE RPC SINGLE-SHOT MODE');
  console.log(` Program:  ${programId.toBase58()}`);
  console.log(` Guardian: ${guardian.publicKey.toBase58()}`);
  console.log('=====================================================');

  const slot = await connection.getSlot('confirmed');
  const { heartRate, eeg } = generateSlotSeededTelemetry(slot);
  const telemetryStreamId = randomStreamId();
  const { pda: proofCheckpointPda } = deriveProofCheckpointPda(
    programId,
    guardian.publicKey,
    telemetryStreamId
  );
  const { maskedHeartRate, maskedStateHash } = maskTelemetry({ heartRate, eeg });
  const timestamp = Math.floor(Date.now() / 1000);
  const ix = buildCommitProofInstruction({
    programId,
    guardian,
    proofCheckpointPda,
    telemetryStreamId,
    maskedStateHash,
    timestamp,
  });
  const tx = new Transaction().add(ix);
  tx.feePayer = guardian.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.sign(guardian);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const confirmation = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'finalized'
  );
  const accountInfo = await connection.getAccountInfo(proofCheckpointPda, 'finalized');
  if (!accountInfo) {
    throw new Error('ProofCheckpoint account was not found after confirmation');
  }

  console.log(`[edge] slot ${slot} -- simulated/slot-seeded HR ${heartRate}bpm -> masked ${maskedHeartRate}bpm, EEG ${eeg}uV`);
  console.log(`[chain] commit_biometric_proof sent -- sig ${signature}`);
  console.log(`[chain] confirmation status: ${confirmation.value.err ? 'failed' : 'finalized'}`);
  console.log(`[chain] ProofCheckpoint PDA: ${proofCheckpointPda.toBase58()}`);
  console.log(`[chain] ProofCheckpoint data: ${JSON.stringify({
    guardian_wallet: new PublicKey(accountInfo.data.subarray(8, 40)).toBase58(),
    telemetry_stream_id: accountInfo.data.subarray(40, 56).toString('hex'),
    masked_state_hash: accountInfo.data.subarray(56, 88).toString('hex'),
    timestamp: accountInfo.data.readBigInt64LE(88).toString(),
    is_active_shield: Boolean(accountInfo.data[96]),
  })}`);

  console.log('[chain] sending trigger_circuit_breaker to verify shield flips to false...');
  const breakerIx = buildTriggerBreakerInstruction({ programId, proofCheckpointPda, guardian });
  const breakerTx = new Transaction().add(breakerIx);
  breakerTx.feePayer = guardian.publicKey;
  const { blockhash: bBlockhash, lastValidBlockHeight: bLvbh } = await connection.getLatestBlockhash('confirmed');
  breakerTx.recentBlockhash = bBlockhash;
  breakerTx.sign(guardian);
  const breakerSig = await connection.sendRawTransaction(breakerTx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ signature: breakerSig, blockhash: bBlockhash, lastValidBlockHeight: bLvbh }, 'finalized');
  const postBreakerAccount = await connection.getAccountInfo(proofCheckpointPda, 'finalized');
  console.log(`[chain] trigger_circuit_breaker sent -- sig ${breakerSig}`);
  console.log(`[chain] is_active_shield after breaker: ${Boolean(postBreakerAccount.data[96])}`);
}

// ---------------------------------------------------------------------------
// Mock fallback path -- no network required
// ---------------------------------------------------------------------------

async function runMockSync({ programId, guardian, reason }) {
  console.log('=====================================================');
  console.log(' NOETOZYN CLIENT SYNC -- MOCK CHAIN MODE');
  console.log(` (${reason} -- simulating locally)`);
  console.log(` Program (mock):  ${programId.toBase58()}`);
  console.log(` Guardian (mock): ${guardian.publicKey.toBase58()}`);
  console.log('=====================================================');

  const telemetryStreamId = randomStreamId();
  const { pda: proofCheckpointPda } = deriveProofCheckpointPda(
    programId,
    guardian.publicKey,
    telemetryStreamId
  );
  console.log(` Simulated checkpoint PDA: ${proofCheckpointPda.toBase58()}`);

  const mockLedger = [];
  let isActiveShield = true;
  let tick = 0;

  const interval = setInterval(() => {
    tick += 1;

    if (!isActiveShield) {
      console.log(`[edge] tick ${tick} -- shield inactive, telemetry passed through unmasked`);
      return;
    }

    const heartRate = 68 + Math.round(Math.random() * 20);
    const eeg = 40 + Math.random() * 15;
    const { maskedHeartRate, maskedStateHash } = maskTelemetry({ heartRate, eeg });
    const timestamp = Math.floor(Date.now() / 1000);

    const entry = {
      tick,
      guardian_wallet: guardian.publicKey.toBase58(),
      telemetry_stream_id: telemetryStreamId.toString('hex'),
      masked_state_hash: maskedStateHash.toString('hex'),
      timestamp,
      is_active_shield: isActiveShield,
    };
    mockLedger.push(entry);

    console.log(
      `[edge] tick ${tick} -- raw HR ${heartRate}bpm -> masked ${maskedHeartRate}bpm`
    );
    console.log(
      `[mock-chain] commit_biometric_proof -- checkpoint updated, ` +
        `hash 0x${maskedStateHash.toString('hex').slice(0, 16)}...`
    );

    // Randomly demonstrate the circuit breaker mid-run, mirroring how a
    // judge could toggle it from interactive_ui.js.
    if (tick === 8) {
      isActiveShield = false;
      console.log('[mock-chain] trigger_circuit_breaker -- shield DEACTIVATED (reason_code=1)');
    }
    if (tick === 12) {
      isActiveShield = true;
      console.log('[mock-chain] guardian re-armed shield manually -- ACTIVE');
    }

    if (tick >= 20) {
      clearInterval(interval);
      console.log('=====================================================');
      console.log(` Mock sync complete -- ${mockLedger.length} checkpoints committed.`);
      console.log('=====================================================');
      process.exit(0);
    }
  }, 1000);

  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\n Mock sync stopped by user.');
    console.log(` Ledger contained ${mockLedger.length} local checkpoints.`);
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const programId = new PublicKey(PROGRAM_ID_STR);
  const guardian = process.env.NOETOZYN_SINGLE_SHOT === '1' ? loadGuardian() : Keypair.generate();
  const connection = new Connection(RPC_ENDPOINT, 'confirmed');

  const reachable = await probeConnection(connection);
  const deployed = reachable && (await probeProgramDeployed(connection, programId));

  if (deployed) {
    if (process.env.NOETOZYN_SINGLE_SHOT === '1') {
      await runSingleShotSync({ connection, programId, guardian });
    } else {
      await runLiveSync({ connection, programId, guardian });
    }
  } else {
    const reason = !reachable
      ? 'RPC endpoint unreachable'
      : `program ${programId.toBase58()} is not deployed or executable`;
    await runMockSync({ programId, guardian, reason });
  }
}

main().catch((err) => {
  console.error('[fatal] client_sync.js crashed:', err);
  process.exit(1);
});
