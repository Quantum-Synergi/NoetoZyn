import { CANONICALIZATION, TELEMETRY_SCHEMA, validateRecords } from './schema.js';
import { canonicalizeRecords, utf8ByteLength } from './canonical.js';

export function createProofPreimage(records) {
  const validated = validateRecords(records);
  const canonical = canonicalizeRecords(validated);
  return [
    'noetozyn-proof-v1',
    `schema=${TELEMETRY_SCHEMA}`,
    `record-count=${validated.length}`,
    `canonical-length=${utf8ByteLength(canonical)}`,
    `canonical=${canonical}`,
  ].join('\n');
}

export async function sha256Hex(text, cryptoAdapter = globalThis.crypto) {
  if (!cryptoAdapter?.subtle?.digest) throw new TypeError('A Web Crypto-compatible adapter is required');
  const digest = await cryptoAdapter.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function computeProofHash(records, cryptoAdapter = globalThis.crypto) {
  return `sha256:${await sha256Hex(createProofPreimage(records), cryptoAdapter)}`;
}

export function bytesToHex(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('randomBytes must return Uint8Array');
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export { CANONICALIZATION };
