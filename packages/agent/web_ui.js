import http from 'http';
import { clusterApiUrl, Connection, PublicKey } from '@solana/web3.js';
import { generateSlotSeededTelemetry, maskTelemetry } from './telemetry_bridge.js';

const PORT = Number(process.env.PORT || 3000);
const RPC_ENDPOINT = process.env.NOETOZYN_RPC || clusterApiUrl('devnet');
const PROGRAM_ID = process.env.NOETOZYN_PROGRAM_ID || null;
const COPILOT_API_BASE = process.env.COLOSSEUM_COPILOT_API_BASE || 'https://copilot.colosseum.com/api/v1';
const COPILOT_PAT = process.env.COLOSSEUM_COPILOT_PAT;
const VERIFIED_TX_SIGNATURE = '4ja8yoS4gApTZm34iPHLutFiCdQqNMrLY9CkPKG6VepZRHLVXbs7b8jtcC3AJNg1rtgKfum1m7oVr8xLwvHBFU69';
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

const explorerTransactionUrl = `https://explorer.solana.com/tx/${VERIFIED_TX_SIGNATURE}?cluster=devnet`;

function jsonResponse(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readChainState() {
  if (!PROGRAM_ID) {
    return { reachable: false, mode: 'MOCK', error: 'NOETOZYN_PROGRAM_ID is not configured' };
  }

  let programId;
  try {
    programId = new PublicKey(PROGRAM_ID);
  } catch {
    return { reachable: false, mode: 'MOCK', error: 'NOETOZYN_PROGRAM_ID is invalid' };
  }

  try {
    const slot = await connection.getSlot('confirmed');
    const blockTime = await connection.getBlockTime(slot);
    const accountInfo = await connection.getAccountInfo(programId, 'confirmed');
    return {
      reachable: true,
      mode: accountInfo?.executable ? 'LIVE' : 'MOCK',
      programId: programId.toBase58(),
      programExecutable: Boolean(accountInfo?.executable),
      slot,
      blockTime,
      explorerTransactionUrl,
    };
  } catch (error) {
    return { reachable: false, mode: 'MOCK', error: `Solana RPC unavailable: ${error.message}` };
  }
}

async function readTelemetry() {
  try {
    const slot = await connection.getSlot('confirmed');
    const telemetry = generateSlotSeededTelemetry(slot);
    const masked = maskTelemetry({ ...telemetry, slot });
    return {
      source: 'simulated / slot-seeded',
      slot,
      heartRate: telemetry.heartRate,
      eeg: telemetry.eeg,
      maskedHeartRate: masked.maskedHeartRate,
      maskedStateHash: `0x${masked.maskedStateHash.slice(0, 16)}...`,
    };
  } catch (error) {
    return { source: 'simulated / slot-seeded', error: `Telemetry slot unavailable: ${error.message}` };
  }
}

async function readCopilot() {
  if (!COPILOT_PAT) {
    return { configured: false, error: 'Copilot credentials are not configured' };
  }

  try {
    const statusResponse = await fetch(`${COPILOT_API_BASE}/status`, {
      headers: { Authorization: `Bearer ${COPILOT_PAT}` },
    });
    if (!statusResponse.ok) {
      return { configured: true, status: 'unavailable', httpStatus: statusResponse.status };
    }

    const searchResponse = await fetch(`${COPILOT_API_BASE}/search/projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${COPILOT_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'privacy-preserving biometric telemetry at the edge',
        limit: 5,
        includeFacets: false,
      }),
    });
    if (!searchResponse.ok) {
      return { configured: true, status: 'authenticated', search: 'unavailable', httpStatus: searchResponse.status };
    }

    const search = await searchResponse.json();
    return {
      configured: true,
      status: 'authenticated',
      totalFound: search.totalFound,
      results: (search.results || []).map((result) => ({
        name: result.name,
        similarity: result.similarity,
        oneLiner: result.oneLiner,
      })),
    };
  } catch (error) {
    return { configured: true, status: 'unavailable', error: `Copilot unavailable: ${error.message}` };
  }
}

function dashboardPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NoetoZyn Dashboard</title>
  <style>
    :root { color-scheme: dark; font-family: sans-serif; background: #101417; color: #e9f0ed; }
    body { margin: 0; padding: 2rem; max-width: 1100px; margin-inline: auto; }
    h1 { margin-top: 0; } main { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    section { border: 1px solid #344247; border-radius: 8px; padding: 1rem; background: #182125; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; color: #b9d9c9; }
    a { color: #86d7ff; } .note { color: #aab9b5; }
  </style>
</head>
<body>
  <h1>NoetoZyn</h1>
  <p class="note">Privacy firewall status dashboard. Biometric values are simulated / slot-seeded.</p>
  <main>
    <section><h2>Solana</h2><pre id="chain">Loading...</pre></section>
    <section><h2>Telemetry</h2><pre id="telemetry">Loading...</pre></section>
    <section><h2>Colosseum Copilot</h2><pre id="copilot">Loading...</pre></section>
  </main>
  <script>
    async function refresh() {
      for (const name of ['chain', 'telemetry', 'copilot']) {
        const response = await fetch('/api/' + name);
        document.getElementById(name).textContent = JSON.stringify(await response.json(), null, 2);
      }
    }
    refresh();
    setInterval(refresh, 10000);
  </script>
</body>
</html>`;
}

const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET') {
    jsonResponse(response, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(dashboardPage());
    } else if (request.url === '/api/chain') {
      jsonResponse(response, 200, await readChainState());
    } else if (request.url === '/api/telemetry') {
      jsonResponse(response, 200, await readTelemetry());
    } else if (request.url === '/api/copilot') {
      jsonResponse(response, 200, await readCopilot());
    } else {
      jsonResponse(response, 404, { error: 'Not found' });
    }
  } catch (error) {
    jsonResponse(response, 500, { error: 'Dashboard request failed' });
  }
});

server.listen(PORT, () => {
  console.log(`NoetoZyn dashboard available on port ${PORT}`);
});
