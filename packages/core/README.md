# @noetozyn/core

`@noetozyn/core` creates and verifies local, proof-only receipts for bounded `telemetry-v1` CSV data. It does not upload data, sign transactions, contact Solana, or anchor receipts.

## Input contract

CSV must use the exact case-sensitive header `heartRate,eeg`, followed by 1 to 1,000 rows. Optional UTF-8 BOM is removed and CRLF/CR line endings become LF. Rows have exactly two unquoted comma-separated fields. Surrounding whitespace around values is trimmed. Input is limited to 1 MiB and each line to 256 UTF-8 bytes.

`heartRate` must be a finite decimal from 20 through 250. `eeg` must be a finite decimal from -1000 through 1000. These are bounded demo payload checks, not health, medical, clinical, or sensor validation.

## Canonicalization and hash

Canonicalization identifier: `telemetry-v1-json-c14n-1`.

Validated rows become a JSON array with preserved order, no spaces, and exact key order: `{"heartRate":<Number.toString()>,"eeg":<Number.toString()>}`. Negative zero becomes `0`.

The UTF-8 preimage has LF separators and no trailing LF:

```text
noetozyn-proof-v1
schema=telemetry-v1
record-count=<decimal>
canonical-length=<UTF-8 byte length>
canonical=<canonical-json>
```

The proof is `sha256:` followed by 64 lowercase hexadecimal characters.

## Browser and Node adapters

Hashing uses an injected Web Crypto-compatible adapter exposing `subtle.digest`. Browser callers can pass `globalThis.crypto`. Node callers can pass Node's Web Crypto implementation, for example `globalThis.crypto` on supported Node versions.

Stream IDs use an injected `randomBytes(16)` adapter. In a browser, implement it with `crypto.getRandomValues(new Uint8Array(16))`; in Node, implement it with `crypto.randomBytes(16)`. The stream ID is 16 random bytes represented as 32 lowercase hexadecimal characters. It is not a signature, secret, identity proof, consent proof, or cryptographic attestation.

## Receipts

A default receipt contains version, schema, algorithm, canonicalization, stream ID, record count, proof hash, UTC creation time, `source: "local-csv"`, and `anchor: { "status": "not-anchored" }`. It contains no raw measurements, CSV, filename, canonical payload, private key, seed phrase, wallet secret, credential, or token.

`validateReceipt` checks receipt structure and prohibited fields. It does not recompute the proof. `verifyLocalProof` validates user-held records, recomputes the local proof, and compares the result with the receipt hash.

A local receipt is not a Solana anchor and does not prove that a blockchain write occurred. The existing NoetoZyn dashboard's server-side simulated devnet checkpoint flow is a separate behavior; this package does not change or invoke it.

## Non-goals

This package does not provide sensor authenticity, identity, consent attestation, encryption, anonymity, formal zero-knowledge proofs, user-wallet signing, a hosted API, mainnet behavior, or automatic anchoring.
