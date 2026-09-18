import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const agentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.join(agentDir, '..', 'public', 'wallet-connect.js');
const forbidden = /signMessage|signTransaction|signAllTransactions|signAndSendTransaction/;

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: requestPath }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
  });
}

async function startServer() {
  const port = 3127;
  const server = spawn(process.execPath, ['web_ui.js'], {
    cwd: agentDir,
    env: { ...process.env, PORT: String(port), NOETOZYN_PROGRAM_ID: '', COLOSSEUM_COPILOT_PAT: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await Promise.race([
    once(server.stdout, 'data'),
    once(server.stderr, 'data').then(([data]) => { throw new Error(data.toString()); }),
    once(server, 'exit').then(([code]) => { throw new Error(`dashboard exited with ${code}`); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('dashboard startup timed out')), 3000)),
  ]);
  return { server, port };
}

test('serves the wallet module and keeps wallet actions local-only', async () => {
  const { server, port } = await startServer();
  try {
    const dashboard = await request(port, '/');
    assert.equal(dashboard.status, 200);
    assert.match(dashboard.body, /<script type="module" src="\/assets\/wallet-connect\.js"><\/script>/);

    const asset = await request(port, '/assets/wallet-connect.js');
    assert.equal(asset.status, 200);
    assert.match(asset.headers['content-type'], /javascript/);
    assert.doesNotMatch(asset.body, /fetch\(|XMLHttpRequest|navigator\.sendBeacon/);
    assert.doesNotMatch(asset.body, forbidden);
    assert.doesNotMatch(asset.body, /\/api\//);
  } finally {
    server.kill('SIGTERM');
    await once(server, 'exit');
  }
});

 test('authored wallet module contains no forbidden signing API names', async () => {
  const source = await readFile(path.join(agentDir, 'src', 'wallet-connect.js'), 'utf8');
  assert.doesNotMatch(source, forbidden);
});
