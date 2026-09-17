import { MAX_INPUT_BYTES, MAX_LINE_BYTES, MAX_ROWS, validateRecords } from './schema.js';

function asText(input) {
  if (typeof input === 'string') return input;
  if (input instanceof Uint8Array) return new TextDecoder('utf-8', { fatal: true }).decode(input);
  throw new TypeError('CSV input must be text or UTF-8 bytes');
}

function byteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}

export function parseTelemetryCsv(input) {
  const original = asText(input);
  if (byteLength(original) > MAX_INPUT_BYTES) throw new RangeError('CSV exceeds the 1 MiB input limit');
  const normalized = original.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length === 0 || lines[0] !== 'heartRate,eeg') throw new TypeError('CSV header must be exactly heartRate,eeg');
  if (lines.length < 2) throw new TypeError('CSV must contain at least one data row');
  for (const line of lines) {
    if (byteLength(line) > MAX_LINE_BYTES) throw new RangeError('CSV line exceeds the 256 byte limit');
  }
  const rows = lines.slice(1);
  if (rows.length > MAX_ROWS) throw new RangeError(`CSV exceeds the ${MAX_ROWS} row limit`);
  if (rows.some((row) => row.trim() === '')) throw new TypeError('CSV cannot contain blank rows');
  const records = rows.map((row, index) => {
    if (row.includes('"')) throw new TypeError(`CSV row ${index + 1} cannot contain quoted fields`);
    const fields = row.split(',');
    if (fields.length !== 2) throw new TypeError(`CSV row ${index + 1} must contain exactly two fields`);
    return { heartRate: fields[0], eeg: fields[1] };
  });
  return validateRecords(records);
}
