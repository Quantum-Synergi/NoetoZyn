import test from 'node:test';
import assert from 'node:assert/strict';
import { createProofPreimage, computeProofHash } from '../src/index.js';

test('uses the browser-compatible Web Crypto interface without network access', async () => {
  assert.equal(typeof globalThis.crypto?.subtle?.digest, 'function');
  const records = [{ heartRate: 72, eeg: 41 }];
  const browserCompatibleAdapter = { subtle: { digest: (...args) => globalThis.crypto.subtle.digest(...args) } };
  assert.equal(createProofPreimage(records), 'noetozyn-proof-v1\nschema=telemetry-v1\nrecord-count=1\ncanonical-length=27\ncanonical=[{"heartRate":72,"eeg":41}]');
  assert.match(await computeProofHash(records, browserCompatibleAdapter), /^sha256:[0-9a-f]{64}$/);
});
