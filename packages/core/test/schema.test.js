import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecord, validateRecords } from '../src/schema.js';

test('validates bounded telemetry records and normalizes negative zero', () => {
  assert.deepEqual(validateRecord({ heartRate: 72, eeg: '-0' }), { heartRate: 72, eeg: 0 });
  assert.deepEqual(validateRecords([{ heartRate: 20, eeg: -1000 }, { heartRate: 250, eeg: 1000 }]), [
    { heartRate: 20, eeg: -1000 }, { heartRate: 250, eeg: 1000 },
  ]);
});

test('rejects malformed numeric values and bounds', () => {
  for (const record of [
    { heartRate: '1e2', eeg: 0 }, { heartRate: '0x40', eeg: 0 },
    { heartRate: 'NaN', eeg: 0 }, { heartRate: 'Infinity', eeg: 0 },
    { heartRate: 19.99, eeg: 0 }, { heartRate: 72, eeg: 1000.1 },
    { heartRate: '', eeg: 0 }, { heartRate: 72, eeg: ' ' },
  ]) assert.throws(() => validateRecord(record), TypeError);
});

test('rejects unknown or misordered record fields', () => {
  assert.throws(() => validateRecord({ eeg: 1, heartRate: 72 }), /order/);
  assert.throws(() => validateRecord({ heartRate: 72, eeg: 1, raw: true }), /only/);
  assert.throws(() => validateRecords([]), /1 to/);
});
