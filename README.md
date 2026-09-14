# NoetoZyn (νοητο-ζύν)
### **The Decentralized Polymorphic Privacy Firewall Agent Architecture on Solana**
***
Developed by **Quantum Synergi** for the **Colosseum Crypto World's Fair Hackathon**

Track Alignment: **DePIN** | **Crypto + AI Convergence** | **Infrastructure & Privacy**

---

## 🔗 Live Demo

**[noetozyn-dashboard.onrender.com](https://noetozyn-dashboard.onrender.com)**

An end-user, publicly deployed dashboard running against Solana devnet. All on-chain state shown (Program ID, slot, block time, transaction signatures, ProofCheckpoint account data) is real and independently verifiable on [Solana Explorer](https://explorer.solana.com/?cluster=devnet). Biometric telemetry is simulated / slot-seeded — deterministically derived from the current Solana slot, never real sensor data.

**Deployed Program ID (devnet):** `RfGptereRgYUVAMwGNVepysjQgJjFbrXyarXnUX7Ama`
**Current guardian wallet:** `9s2yADXmouAVAGwADrTan84g8jPeVoNFaW3RjiSRdZLM`

**Visual convention used throughout the dashboard:** solid blue border = real on-chain/network state. Dashed coral border = simulated/local content — this distinction is never blurred.


NoetoZyn establishes an unprecedented paradigm shift at the intersection of **Confidential AI Systems and Onchain Physical Infrastructure (DePIN)**. It is an autonomous edge agent engineered to return absolute cognitive, neurological, and biological sovereignty to humanity.

---

## Executive Summary (Non-Technical)

### **The Threat: Biological & Cognitive Forgery**
As consumer wearables, smart health patches, and neural interfaces become mainstream, humanity faces an invisible crisis: **the absolute corporate capture of human biology**. These devices continuously stream raw, un-encrypted physiological data (heart rate variability, EEG brainwaves, metabolic inputs) directly into centralized cloud databases. These unique biological signatures are aggregated, modeled, and weaponized by centralized AI systems to profile human attention, predict behavioral shifts, and exploit emotional vulnerabilities.

### **The Solution: A Body-Boundary Shield**
**NoetoZyn flips the battlefield.** Instead of forcing humans to detach from advanced technology, NoetoZyn operates as an active, intelligent **Biometric Firewall** right at the network edge. It allows everyday citizens to confidently **explore** advanced health tech, financially **thrive** by owning their anonymized data footprints, and truly **sleep safe at night** knowing their physical bodies and minds remain structurally dark to predatory algorithms. 

*“Sovereignty does not stop at the digital UI. It begins at the biological layer.”* — **Quantum Synergi**

---

## The Core Problems Solved

* **Predatory Data Harvesting:** Monopolistic LLM scrapers ingest high-value biometric metrics without user consent or explicit economic compensation.
* **Biological Identity Cloning:** Centralized storage of raw telemetry maps immutable, unique human physiological profiles that can be reverse-engineered or falsified if leaked.
* **Algorithmic Vulnerability Exploitation:** Continuous analysis of human stress markers allows external interfaces to execute psychological target manipulations in real-time.

---

## Technical Architecture & System Flow (Technical)

![Privacy firewall data flow](docs/privacy-flow.svg)

NoetoZyn is a Solana devnet demo that pairs a simulated biometric reading with real, independently verifiable on-chain state.

### System Data Pipeline
* **Simulated telemetry generation:** a heart-rate/EEG-style reading is deterministically derived from the current Solana slot — not from any real sensor or wearable.
* **Masking:** the reading is passed through a masking function before hashing, so raw values never leave the process that generates them.
* **SHA-256 hashing:** the masked state is hashed, producing a fixed-size digest with no reversible link back to the fabricated inputs.
* **On-chain commit:** the hash, a telemetry stream ID, and a timestamp are written to a Solana Anchor account (`ProofCheckpoint`), signed by a server-side guardian keypair.
* **Guardian-controlled circuit breaker:** a `trigger_circuit_breaker` instruction can deactivate an active shield. This is a one-way action — it cannot be reactivated without a separate contract upgrade.

### What's real vs. simulated
Every piece of on-chain state — the program ID, transaction signatures, account data, slot numbers, and block times — is real and independently verifiable on [Solana Explorer](https://explorer.solana.com/?cluster=devnet). The biometric values themselves are always simulated / slot-seeded and are never presented as real sensor, medical, or health data. Throughout the dashboard, a solid blue border marks real on-chain/network state; a dashed coral border marks simulated or local-only content.

### Dashboard Features
* **Simulated capture → mask → commit → verify → proof** stepper walking through the full flow live.
* **Try it with your own data:** upload a CSV (expects `heartRate` and `eeg` columns) or use built-in sample data. All processing happens entirely in the browser — nothing is uploaded to a server.
* **Download Local Proof / Local Report (.json):** generates a browser-only proof artifact from local or captured data, downloaded directly to the user's device.
* **Anchor this hash on devnet:** with explicit consent, publishes a locally-computed hash as a real, one-way devnet transaction.
* **Proof Checkpoint Viewer:** reads and decodes the real on-chain `ProofCheckpoint` account (PDA, guardian, stream ID, masked hash, shield status, timestamp) directly from Solana devnet.
* **Circuit breaker control:** guardian-signed, one-way deactivation of an active shield.
* **Live Copilot novelty check:** queries Colosseum Copilot's project-search API in real time from the dashboard itself.
* **Activity timeline:** a running, timestamped log of real actions taken in the current browser session (captures, commits, verifications, errors) — capped at 50 entries.


## Smart Contract Schema & State Specifications

The on-chain protocol state ledger is built using the **Solana Anchor Framework**, designed for absolute gas optimization and sub-second validation routines.

### **On-Chain State Account Layout**
```rust
#[account]
pub struct ProofCheckpoint {
 pub guardian_wallet: Pubkey, // 32 bytes | The sovereign user's authority key
 pub telemetry_stream_id: [u8; 16], // 16 bytes | Unique ephemerally rotated stream tag
 pub masked_state_hash: [u8; 32], // 32 bytes | The cryptographic hash of the perturbed vitals
 pub timestamp: i64, // 8 bytes | Unix epoch millisecond verification lock
 pub is_active_shield: bool, // 1 byte | Guardian-controlled shield status flag
}
```

### **The Sovereign Bio-Circuit Breaker**
The guardian wallet can call the `trigger_circuit_breaker` instruction on-chain to deactivate an active shield. This flips the `is_active_shield` flag to false on the `ProofCheckpoint` account. This action is one-way — the deployed instruction cannot reactivate a deactivated shield without a separate contract upgrade.

---

## Competitive Landscape & Novelty (Colosseum Copilot Search)

NoetoZyn's core concept — biometric privacy firewall, edge-side telemetry masking,
health/EEG data, zero-knowledge-adjacent proofs — was checked against Colosseum
Copilot's project-search corpus (`/search/projects`), which spans 5,400+ Solana
hackathon submissions.

As of **September 11, 2026**, a live query returned 6 total results, with the
closest matches shown below (similarity scores, live from the dashboard's
`/api/copilot` endpoint):

| Project | Similarity | What it does |
|---|---|---|
| Spiral Safe | 0.054 | Simplifies Web3 onboarding by replacing seed phrases with passkeys and biometrics |
| DTOX | 0.032 | Decentralized telemetry and monitoring infrastructure built on Solana |
| zk-IoT | 0.032 | Zero-knowledge verification of IoT sensor data on Solana for private compliance payouts |
| AIGun | 0.031 | An AI-driven exchange delivering trading signals and execution without noise |
| AI FHE Healthcare IoT | 0.031 | Privacy-preserving AI combining healthcare IoT devices and Zama FHE with Solana rewards |

**Reading the gap:** the closest adjacent projects use biometrics for *authentication*
(Spiral Safe), general IoT/telemetry *infrastructure* (DTOX), IoT sensor *compliance*
proofs (zk-IoT), or FHE-based *healthcare* data privacy (the last entry) — none of
them intercept raw biometric telemetry at the edge and apply polymorphic masking
in real time before it ever leaves the device, anchoring only the masked-state hash
on-chain. All similarity scores stayed under 0.06.

This reflects one search against Copilot's corpus at a single point in time, not a
permanent or exhaustive claim — the corpus grows as new projects are submitted, so
this table will drift. Rather than treat this snapshot as definitive, NoetoZyn's
live dashboard queries Copilot's `/search/projects` endpoint directly and in real
time: **run it yourself and see the current results**, rather than trusting a
static table in a README.
---

## Ecosystem Alignment with the World's Fair

* **DePIN:** Redefines Decentralized Physical Infrastructure by pushing the perimeter security directly to the human biological layer, turning individual wearables into sovereign node citadels.
* **Crypto + AI Convergence:** Shifts artificial intelligence from a predatory extraction tool into a localized, alignment-driven guardian bounded firmly by deterministic blockchain law.
* **Performance & Scale:** Utilizes Solana's ultra-low base transaction fees to seamlessly manage high-velocity telemetry proof handshakes at scale without economic friction.

***
### **Quantum Synergi** • *Vanguard Technologies for the Sovereign Era.*
