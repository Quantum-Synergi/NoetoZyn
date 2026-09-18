import test from 'node:test';
import assert from 'node:assert/strict';
import receiptFixture from '../fixtures/receipt-v1.json' with { type: 'json' };
import { createProofReceipt, validateReceipt, verifyLocalProof } from '../src/receipt.js';

const records = [{ heartRate: 72, eeg: 41 }, { heartRate: 73.5, eeg: -40.25 }];
const randomBytes = (length) => Uint8Array.from({ length }, (_, index) => index);
const cryptoAdapter = globalThis.crypto;

async function receipt() {
  return createProofReceipt(records, { randomBytes, createdAt: '2026-09-17T00:00:00.000Z', cryptoAdapter });
}

test('creates a deterministic proof-only receipt', async () => {
  const value = await receipt();
  assert.deepEqual(value, {
    receiptVersion: 'noetozyn-proof-receipt-v1', schema: 'telemetry-v1', hashAlgorithm: 'SHA-256',
    canonicalization: 'telemetry-v1-json-c14n-1', streamId: '000102030405060708090a0b0c0d0e0f', recordCount: 2,
    proofHash: 'sha256:5f6341e7ea8de52c136a840e680c06e45945023319a170aeda568b2374b4f5c4', createdAt: '2026-09-17T00:00:00.000Z', source: 'local-csv', anchor: { status: 'not-anchored' },
  });
  assert.equal(Object.hasOwn(value, 'raw'), false);
});

test('validates structure separately and rejects prohibited or unknown fields', async () => {
  const value = await receipt();
  assert.equal(validateReceipt(value), value);
  assert.equal(validateReceipt(receiptFixture), receiptFixture);
  assert.equal(validateReceipt({ ...receiptFixture, recordCount: 1 }).recordCount, 1);
  assert.equal(validateReceipt({ ...receiptFixture, recordCount: 1000 }).recordCount, 1000);
  for (const recordCount of [0, -1, 1.5, 1001]) {
    assert.throws(() => validateReceipt({ ...receiptFixture, recordCount }), /recordCount/);
  }
  for (const createdAt of ['2026-02-30T00:00:00.000Z', '2026-13-01T00:00:00.000Z', 'not-a-date']) {
    assert.throws(() => validateReceipt({ ...receiptFixture, createdAt }), /createdAt/);
  }
  for (const field of ['heartRate', 'eeg', 'raw', 'csv', 'filename', 'privateKey', 'seedPhrase', 'walletSecret', 'credential', 'token']) {
    assert.throws(() => validateReceipt({ ...value, [field]: 'forbidden' }), /prohibited/);
  }
  assert.throws(() => validateReceipt({ ...value, extra: true }), /unknown/);
});

test('verifies matching records and rejects changed records', async () => {
  const value = await receipt();
  assert.equal(await verifyLocalProof(value, records, cryptoAdapter), true);
  assert.equal(await verifyLocalProof(receiptFixture, records, cryptoAdapter), true);
  assert.equal(await verifyLocalProof(value, [{ heartRate: 72, eeg: 42 }, records[1]], cryptoAdapter), false);
});
