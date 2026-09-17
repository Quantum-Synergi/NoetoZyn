export const TELEMETRY_SCHEMA = 'telemetry-v1';
export const CANONICALIZATION = 'telemetry-v1-json-c14n-1';
export const MAX_ROWS = 1000;
export const MAX_INPUT_BYTES = 1024 * 1024;
export const MAX_LINE_BYTES = 256;

const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function fail(message) {
  throw new TypeError(message);
}

export function parseDecimal(value, field, rowNumber) {
  if (typeof value !== 'string') fail(`${field} at row ${rowNumber} must be text`);
  const text = value.trim();
  if (!text || !DECIMAL_PATTERN.test(text)) {
    fail(`${field} at row ${rowNumber} must be a decimal number`);
  }
  const number = Number(text);
  if (!Number.isFinite(number)) fail(`${field} at row ${rowNumber} must be finite`);
  return Object.is(number, -0) ? 0 : number;
}

export function validateRecord(record, rowNumber = 1) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail(`record ${rowNumber} must be an object`);
  }
  const keys = Object.keys(record);
  if (keys.length !== 2 || keys[0] !== 'heartRate' || keys[1] !== 'eeg') {
    fail(`record ${rowNumber} must contain only heartRate and eeg in order`);
  }
  const heartRate = typeof record.heartRate === 'number'
    ? (Number.isFinite(record.heartRate) ? (Object.is(record.heartRate, -0) ? 0 : record.heartRate) : fail(`heartRate at row ${rowNumber} must be finite`))
    : parseDecimal(String(record.heartRate), 'heartRate', rowNumber);
  const eeg = typeof record.eeg === 'number'
    ? (Number.isFinite(record.eeg) ? (Object.is(record.eeg, -0) ? 0 : record.eeg) : fail(`eeg at row ${rowNumber} must be finite`))
    : parseDecimal(String(record.eeg), 'eeg', rowNumber);
  if (heartRate < 20 || heartRate > 250) fail(`heartRate at row ${rowNumber} is outside demo bounds`);
  if (eeg < -1000 || eeg > 1000) fail(`eeg at row ${rowNumber} is outside demo bounds`);
  return { heartRate, eeg };
}

export function validateRecords(records) {
  if (!Array.isArray(records) || records.length < 1 || records.length > MAX_ROWS) {
    fail(`records must contain 1 to ${MAX_ROWS} rows`);
  }
  return records.map((record, index) => validateRecord(record, index + 1));
}
