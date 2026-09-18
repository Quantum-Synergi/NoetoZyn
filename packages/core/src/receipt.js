import { CANONICALIZATION, MAX_ROWS, TELEMETRY_SCHEMA, validateRecords } from './schema.js';
import { bytesToHex, computeProofHash } from './hash.js';

const RECEIPT_VERSION = 'noetozyn-proof-receipt-v1';
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const STREAM_PATTERN = /^[0-9a-f]{32}$/;
const PROHIBITED_FIELDS = new Set(['heartRate', 'eeg', 'raw', 'csv', 'filename', 'privateKey', 'seedPhrase', 'walletSecret', 'credential', 'token']);
const RECEIPT_KEYS = ['receiptVersion', 'schema', 'hashAlgorithm', 'canonicalization', 'streamId', 'recordCount', 'proofHash', 'createdAt', 'source', 'anchor'];

function fail(message) { throw new TypeError(message); }

export function createStreamId(randomBytes) {
  if (typeof randomBytes !== 'function') fail('randomBytes adapter is required');
  const bytes = randomBytes(16);
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) fail('randomBytes(16) must return 16 bytes');
  return bytesToHex(bytes);
}

function assertNoProhibitedFields(value, path = 'receipt') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (PROHIBITED_FIELDS.has(key)) fail(`${path}.${key} is prohibited`);
    assertNoProhibitedFields(child, `${path}.${key}`);
  }
}

export function validateReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) fail('receipt must be an object');
  assertNoProhibitedFields(receipt);
  const keys = Object.keys(receipt);
  if (keys.length !== RECEIPT_KEYS.length || keys.some((key, index) => key !== RECEIPT_KEYS[index])) fail('receipt contains unknown or misordered fields');
  if (receipt.receiptVersion !== RECEIPT_VERSION) fail('unsupported receipt version');
  if (receipt.schema !== TELEMETRY_SCHEMA || receipt.hashAlgorithm !== 'SHA-256' || receipt.canonicalization !== CANONICALIZATION) fail('receipt contract fields are invalid');
  if (!STREAM_PATTERN.test(receipt.streamId)) fail('streamId must be 32 lowercase hexadecimal characters');
  if (!Number.isSafeInteger(receipt.recordCount) || receipt.recordCount < 1 || receipt.recordCount > MAX_ROWS) fail(`recordCount must be an integer from 1 to ${MAX_ROWS}`);
  if (!HASH_PATTERN.test(receipt.proofHash)) fail('proofHash must be sha256 followed by 64 lowercase hexadecimal characters');
  const parsedCreatedAt = typeof receipt.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.createdAt) ? Date.parse(receipt.createdAt) : Number.NaN;
  if (Number.isNaN(parsedCreatedAt) || new Date(parsedCreatedAt).toISOString() !== receipt.createdAt) fail('createdAt must be an ISO 8601 UTC timestamp');
  if (receipt.source !== 'local-csv') fail('source must be local-csv');
  if (!receipt.anchor || typeof receipt.anchor !== 'object' || Object.keys(receipt.anchor).length !== 1 || receipt.anchor.status !== 'not-anchored') fail('anchor status must be not-anchored');
  return receipt;
}

export async function createProofReceipt(records, { randomBytes, createdAt = new Date().toISOString(), cryptoAdapter = globalThis.crypto } = {}) {
  const validated = validateRecords(records);
  const receipt = {
    receiptVersion: RECEIPT_VERSION,
    schema: TELEMETRY_SCHEMA,
    hashAlgorithm: 'SHA-256',
    canonicalization: CANONICALIZATION,
    streamId: createStreamId(randomBytes),
    recordCount: validated.length,
    proofHash: await computeProofHash(validated, cryptoAdapter),
    createdAt: typeof createdAt === 'function' ? createdAt() : createdAt,
    source: 'local-csv',
    anchor: { status: 'not-anchored' },
  };
  return validateReceipt(receipt);
}

export async function verifyLocalProof(receipt, records, cryptoAdapter = globalThis.crypto) {
  validateReceipt(receipt);
  const validated = validateRecords(records);
  if (validated.length !== receipt.recordCount) return false;
  return (await computeProofHash(validated, cryptoAdapter)) === receipt.proofHash;
}

export { RECEIPT_VERSION };
