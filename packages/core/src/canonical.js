import { CANONICALIZATION, validateRecords } from './schema.js';

export { CANONICALIZATION };

export function canonicalizeRecords(records) {
  const validated = validateRecords(records);
  return `[${validated.map(({ heartRate, eeg }) => `{"heartRate":${heartRate.toString()},"eeg":${eeg.toString()}}`).join(',')}]`;
}

export function utf8ByteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}
