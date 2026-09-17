import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTelemetryCsv } from '../src/csv.js';
import invalidCases from '../fixtures/telemetry-v1-invalid.json' with { type: 'json' };

const records = [{ heartRate: 72, eeg: 41 }, { heartRate: 73.5, eeg: -40.25 }];
const lf = 'heartRate,eeg\n 72 , 41 \n73.5,-40.25';

test('parses equivalent LF, CRLF, CR, and BOM CSV inputs', () => {
  const crlf = lf.replaceAll('\n', '\r\n');
  const cr = lf.replaceAll('\n', '\r');
  assert.deepEqual(parseTelemetryCsv(lf), records);
  assert.deepEqual(parseTelemetryCsv(crlf), records);
  assert.deepEqual(parseTelemetryCsv(cr), records);
  assert.deepEqual(parseTelemetryCsv(`\uFEFF${crlf}`), records);
  assert.deepEqual(parseTelemetryCsv(new TextEncoder().encode(lf)), records);
});

test('accepts one final newline but rejects genuine blank rows', () => {
  assert.deepEqual(parseTelemetryCsv('heartRate,eeg\n72,41\n'), [{ heartRate: 72, eeg: 41 }]);
  assert.throws(() => parseTelemetryCsv('heartRate,eeg\n72,41\n\n73,42'), TypeError);
  assert.throws(() => parseTelemetryCsv('heartRate,eeg\n72,41\n\n'), TypeError);
});

test('loads and rejects every invalid CSV fixture case', () => {
  for (const invalidCase of invalidCases) {
    assert.throws(() => parseTelemetryCsv(invalidCase.csv), TypeError, invalidCase.name);
  }
});

test('rejects invalid headers, rows, quotes, commas, and blanks', () => {
  for (const csv of [
    'heartrate,eeg\n72,41', 'eeg,heartRate\n41,72', 'heartRate,eeg\n72',
    'heartRate,eeg\n72,41,extra', 'heartRate,eeg\n"72",41',
    'heartRate,eeg\n72,"41,2"', 'heartRate,eeg\n72,41\n\n73,42', 'heartRate,eeg\n72,',
  ]) assert.throws(() => parseTelemetryCsv(csv), TypeError);
});

test('accepts exactly one and 1,000 rows and rejects 1,001 rows', () => {
  const row = '20,0';
  assert.equal(parseTelemetryCsv(`heartRate,eeg\n${row}`).length, 1);
  assert.equal(parseTelemetryCsv(`heartRate,eeg\n${Array(1000).fill(row).join('\n')}`).length, 1000);
  assert.throws(() => parseTelemetryCsv(`heartRate,eeg\n${Array(1001).fill(row).join('\n')}`), RangeError);
});

test('enforces UTF-8 line and input-size limits', () => {
  const exactLine = `${' '.repeat(126)}20,0${' '.repeat(126)}`;
  const longLine = `${' '.repeat(126)}20,0${' '.repeat(127)}`;
  assert.equal(new TextEncoder().encode(exactLine).byteLength, 256);
  assert.equal(parseTelemetryCsv(`heartRate,eeg\n${exactLine}`)[0].heartRate, 20);
  assert.throws(() => parseTelemetryCsv(`heartRate,eeg\n${longLine}`), RangeError);

  const multibyteLine = `20,0${'é'.repeat(127)}`;
  assert.ok(multibyteLine.length < 257);
  assert.ok(new TextEncoder().encode(multibyteLine).byteLength > 256);
  assert.throws(() => parseTelemetryCsv(`heartRate,eeg\n${multibyteLine}`), RangeError);

  const oversized = `heartRate,eeg\n${'20,0\n'.repeat(220000)}`;
  assert.ok(new TextEncoder().encode(oversized).byteLength > 1024 * 1024);
  assert.throws(() => parseTelemetryCsv(oversized), RangeError);
});
