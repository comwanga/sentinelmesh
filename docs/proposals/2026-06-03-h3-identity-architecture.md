# H-3 — Persistent, Recoverable Identity: Architecture Proposal (DRAFT)

Status: **DRAFT for review** · Author: hardening track · Date: 2026-06-03
Audit refs: H-3 (ephemeral identity, no recovery), C-3 (social graph), B-track (privacy).

> This is a draft to unblock the decision. It does not change code yet. Sections marked **DECISION** need maintainer input before implementation.

---

## 1. Problem

A SentinelMesh identity is a Nostr keypair. Today (`nostrService.ts`):

- Without a NIP-07 browser extension, the keypair is **ephemeral and in-memory only** — it is regenerated on every page refresh (`getOrCreateEphemeralKeypair`).
- There is **no persistence and no recovery**. A refresh silently changes the user's pubkey.

### Why this is the next real-world-testing blocker
A changing pubkey silently breaks everything keyed on identity:
- **Family circles** — membership is by pubkey; a new pubkey = ejected from your circle exactly when you need it (the safety-critical moment).
- **Reputation / consensus (C-1)** — `users.reputation_tier` is per pubkey; a new pubkey resets you to NEWCOMER, and the established-voter gate can never bootstrap because nobody accumulates reputation.
- **Encrypted location (H-2)** — circle keys are wrapped to a pubkey; losing it loses access.
- **Report attribution & history** — your reports are orphaned.

Ordinary users (no NIP-07 extension, the overwhelming majority) cannot complete a second session as the same person. Pilot testing with real families is impossible until this is fixed.

### Failure modes to design against
1. Refresh/restart loses identity. (today: guaranteed)
2. Device lost/replaced loses identity with no backup. (today: guaranteed)
3. Key stolen via XSS / malicious extension → full impersonation, no revocation.
4. User forgets their passphrase → unrecoverable (acceptable *if* clearly communicated and a backup existed).

---

## 2. Requirements

| # | Requirement | Priority |
|---|---|---|
| R1 | Identity persists across sessions/refreshes on the same device | Must |
| R2 | Works with **no browser extension** (mass-adoption path) | Must |
| R3 | At rest, the secret key is **encrypted** (not raw in localStorage) | Must |
| R4 | Explicit, understandable **backup/export** so a user can recover on a new device | Must |
| R5 | No PII, no custodial server key, no phone/email (honour privacy principles) | Must |
| R6 | NIP-07 extension still supported (power users) | Should |
| R7 | Honest UX: "if you lose your backup **and** your passphrase, your identity is gone" | Must |
| R8 | Path to multi-device and/or recovery that doesn't centralise trust | Could |
| R9 | Minimise the window the raw key is exposed to JS/XSS | Should |

Non-goal: account "reset" via a server (impossible without custody; out of scope by principle).

---

## 3. Options

### A. Passphrase-encrypted local key (NIP-49 `ncryptsec`) — **baseline**
Generate the secp256k1 key on-device. Encrypt it with a key derived from a user passphrase (NIP-49 uses scrypt + XChaCha20-Poly1305) and store the **ciphertext** in IndexedDB. On app open, prompt for the passphrase, decrypt into memory for the session.
- **Pros:** standard (NIP-49), no extension, encrypted at rest (R3), export = the `ncryptsec` string (R4), no server (R5). Solves R1/R2.
- **Cons:** passphrase UX friction on each cold start; forgotten passphrase = lost (mitigated by R7 + backup); raw key still lives in JS memory during the session (R9 only partially).

### B. NIP-07 extension (Alby, nos2x, …)
Key lives in the extension; app calls `window.nostr.signEvent`.
- **Pros:** best key hygiene (raw key never in app memory), already supported, multi-site identity.
- **Cons:** requires install — **not viable as the only path** for families/NGOs on mobile. Keep as an opt-in enhancement (R6).

### C. NIP-46 remote signer ("bunker"/nsecbunker)
Key held by a remote signer; app holds only a connection token.
- **Pros:** strong key isolation, multi-device, revocable.
- **Cons:** needs a signer service (self-host or third-party) → operational + trust surface; too heavy for v1. Revisit for orgs.

### D. Custodial / server-held key — **rejected**
Violates R5 and the project's stated privacy principles. Not considered further.

### E. Social recovery (Shamir split among circle members)
Split the key (or a recovery secret) into shares distributed to trusted circle members; reconstruct with `k`-of-`n`.
- **Pros:** recovery without a server or passphrase; aligns with the "family circle" trust model.
- **Cons:** complex UX, needs circles to exist first, coordination to recover. Strong **phase-2** candidate, not v1.

### F. Passkey / WebAuthn-PRF wrapping
Use a platform passkey's PRF extension to derive a wrapping key that encrypts the Nostr key in IndexedDB; unlock via biometric/device auth instead of a passphrase.
- **Pros:** no passphrase to forget, phishing-resistant unlock, great mobile UX, key wrapped by hardware-backed secret (improves R9).
- **Cons:** PRF support is still uneven across browsers (2026: good on Chrome/Android/Safari, partial elsewhere); passkey loss needs a fallback (so still needs an export). Excellent **phase-2** once support is universal.

---

## 4. Recommended architecture (layered, phased)

**DECISION needed — proposed default:** ship Option **A (NIP-49 passphrase-encrypted local key)** as the universal baseline, with **B (NIP-07)** auto-detected and preferred when present, an explicit **backup/restore** flow, and a roadmap to **F (passkey unlock)** then **E (social recovery)**.

```
Identity resolution order at startup:
  1. NIP-07 extension present?         → use it (no local key needed)        [B]
  2. Encrypted key in IndexedDB?       → prompt passphrase → decrypt to memory [A]
  3. Nothing yet (new user)            → onboarding: generate + set passphrase + force backup
```

### Storage & crypto
- secp256k1 key generated client-side (existing `nostr-tools`).
- Encrypt with NIP-49 (`nip19`/`nip49` in nostr-tools): scrypt KDF (tune log_n for ~250 ms on mid mobile) → XChaCha20-Poly1305.
- Persist **only the `ncryptsec` ciphertext** in IndexedDB (reuse the H-2 IndexedDB store; never localStorage).
- Decrypted secret held in a module-scoped variable for the session; cleared on lock/sign-out. (Raw key in JS memory is unavoidable with nostr-tools signing — see §6 / R9.)

### Backup / recovery (R4, R7)
- Onboarding **forces** a backup step: show the `ncryptsec` (and offer the raw `nsec` behind a "show advanced / I understand the risk" gate) with copy + download.
- Settings → "Show recovery backup" any time.
- Restore flow: paste `ncryptsec` + passphrase, or `nsec`.
- Explicit, repeated copy: **"No one can recover this for you. If you lose both your backup and your passphrase, this identity is gone forever."**

### Reputation continuity
Persistent identity is the prerequisite for C-1's established-voter gate to ever bootstrap — call this out in the C-1 follow-up.

---

## 5. UX flows (sketch)

- **First run:** "Create your SentinelMesh identity" → generate → "Set a passphrase to protect it on this device" → "Back up your recovery code" (mandatory, with download) → done.
- **Returning (same device):** "Unlock" passphrase prompt (with "use device passkey" once F lands).
- **New device:** "Restore" → paste recovery code + passphrase.
- **NIP-07 users:** detected → skip all of the above; show "Using your Nostr extension."

---

## 6. Security considerations
- **At rest:** ciphertext only; scrypt params sized to make offline brute force expensive.
- **In memory:** the decrypted secp256k1 key is exposed to JS during a session (nostr-tools signs in JS). XSS during an unlocked session can exfiltrate it → identity theft, no revocation. Mitigations: tighten CSP, minimise dependencies, auto-lock after inactivity, and pursue **F (passkey-wrapped)** + a WASM/worker-isolated signer later. **This residual risk should be documented honestly** (ties to the privacy-claims rewrite already done).
- **No revocation:** Nostr has no native key revocation. If a key is compromised, the only remedy is migrating to a new key and re-establishing circles/reputation — another reason social recovery (E) and clear backup hygiene matter.
- **Phishing:** the restore flow (paste nsec) is phishing-bait; warn, and prefer NIP-07/passkey paths.

---

## 7. Phased implementation plan

- **Phase 3a (unblocks pilots):** Option A end-to-end — generate, NIP-49 encrypt, IndexedDB persist, passphrase unlock, mandatory backup + restore, NIP-07 detection. Remove silent ephemeral regeneration. (Largest user-facing win; do first.)
- **Phase 3b:** auto-lock on inactivity; CSP hardening; settings backup re-export; migration for any existing ephemeral users (prompt to create+back up).
- **Phase 3c:** Passkey/WebAuthn-PRF unlock (Option F) as an alternative to passphrase where supported.
- **Phase 3d:** Social recovery (Option E) — Shamir `k`-of-`n` across circle members.

---

## 8. Open questions (DECISION)
1. **Passphrase vs passkey-first** for v1? (Proposal: passphrase baseline now, passkey in 3c — passkey-first risks excluding browsers without PRF.)
2. **Mandatory backup gate** at onboarding (blocks use until backed up) vs. strong nudge? (Proposal: mandatory — safety app, identity loss is severe.)
3. Scrypt cost target (unlock latency budget on low-end mobile)? (Proposal: ~250 ms.)
4. Do we want **multi-device** in the near term (pushes toward NIP-46/passkey) or is single-device + manual restore acceptable for the pilot? (Proposal: single-device + restore for pilot.)
5. Auto-lock timeout default? (Proposal: 30 min inactivity.)

---

## 9. Relationship to other hardening
- **C-1:** persistent identity is the bootstrap prerequisite for reputation/established-voter gating.
- **H-2:** reuse the IndexedDB key store; circle keys (AES, non-extractable) already live there.
- **C-2/C-3:** a stable pubkey is also what makes the location/social-graph data linkable — the privacy redesign and this proposal must be reviewed together (a stable identity increases linkability even as it improves usability).
