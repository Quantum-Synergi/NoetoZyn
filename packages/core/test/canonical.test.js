import test from 'node:test';
import assert from 'node:assert/strict';
import validFixture from '../fixtures/telemetry-v1-valid.json' with { type: 'json' };
import { canonicalizeRecords, utf8ByteLength } from '../src/canonical.js';

test('canonicalizes exact key order, no spaces, row order, and negative zero', () => {
  const canonical = canonicalizeRecords([
    { heartRate: 72, eeg: -0 },
    { heartRate: 73.5, eeg: -40.25 },
  ]);
  assert.equal(canonical, '[{"heartRate":72,"eeg":0},{"heartRate":73.5,"eeg":-40.25}]');
  assert.equal(utf8ByteLength(canonical), new TextEncoder().encode(canonical).byteLength);
});

test('loads the valid telemetry fixture and preserves its records', () => {
  assert.equal(canonicalizeRecords(validFixture.records), '[{"heartRate":72,"eeg":41},{"heartRate":73.5,"eeg":-40.25}]');
});
