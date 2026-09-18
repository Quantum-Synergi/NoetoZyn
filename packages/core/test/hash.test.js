import test from 'node:test';
import assert from 'node:assert/strict';
import vectors from '../fixtures/hash-vectors.json' with { type: 'json' };
import { computeProofHash, createProofPreimage } from '../src/hash.js';

const cryptoAdapter = globalThis.crypto;

test('creates the exact preimage and fixed SHA-256 vector', async () => {
  const vector = vectors[0];
  assert.equal(createProofPreimage(vector.records), vector.preimage);
  assert.equal(await computeProofHash(vector.records, cryptoAdapter), vector.proofHash);
});
