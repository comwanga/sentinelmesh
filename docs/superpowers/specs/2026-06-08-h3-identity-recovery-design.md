# H-3 Layer 2 — Identity Recovery (Design)

Date: 2026-06-08
Audit ref: H-3 ("Identity is ephemeral by default; no recovery"), FINAL-audit-report.md
Builds on: `docs/superpowers/specs/2026-06-07-h3-identity-persistence-design.md` (Layer 1, shipped in PR #57)
Branch goal: let a user recover their full SentinelMesh identity — the Nostr key **and** the circles it
belongs to — onto a new or wiped device, via a self-custodial, passphrase-encrypted backup file that no
server ever sees.

## Problem

Layer 1 made the Nostr identity persist across reloads (encrypted at rest under a non-extractable device
key). But that key lives **only** on the one device. If the user loses the phone, replaces it, clears
browser storage, or reinstalls, the identity — and therefore every family circle, every reputation, every
trust relationship tied to that pubkey — is gone. For a public-safety pilot, recovery is nearly as
important as security: real users lose phones and clear storage, and if recovery is poor, users disappear
and their circles collapse with them.

## What recovery actually requires

The gateway tokenizes circle membership as `circle_token = "v1:" || HMAC-SHA256(CIRCLE_TOKEN_SECRET,
circle_id || pubkey)` (see `services/gateway/src/circles/token.rs`). The token is a deterministic function
of `(circle_id, pubkey)`. **Consequence: restoring the Nostr secret key — same pubkey — re-establishes
server-side membership automatically, with no server change.** The server already recognizes the restored
user as a member/owner of every circle whose token it holds.

So recovery reduces to reproducing exactly three client-side artifacts on the new device:

1. **The Nostr secret key** (32 bytes) — restores identity, which restores server membership for free.
2. **The list of circle IDs** — needed to query `GET /api/circles?ids=` (the server no longer enumerates
   a user's circles, per C-3; the client tracks its own ids in `circleIdStore`).
3. **The per-circle AES keys** (raw 256-bit each) — needed to decrypt the E2EE circle content (names,
   member labels, locations). These are stored **non-extractable** in IndexedDB today (`e2eeService`), so
   they cannot simply be read back out; the backup mechanism must capture the raw material at the moment
   it is legitimately in hand.

Together these three are the "whole vault" that Layer 1's versioned envelope left a seam for.

## Recovery model (chosen)

**Manual, passphrase-encrypted backup file.** The user exports an encrypted vault file and stores it
themselves (cloud drive, password manager, USB, printout of the file, etc.); on a new device they import
that file and enter the passphrase. Fully self-custodial and **operator-blind** — the server never holds
the backup, the plaintext, or the passphrase. This matches SentinelMesh's privacy / Bitcoin
self-custody principles. The trade-off (the user must keep the file and remember the passphrase, with no
reset) is inherent to self-custody and is surfaced honestly in the UI.

Rejected alternatives: server-stored passphrase-encrypted ciphertext (lower friction but adds a DB table,
endpoints, and a server that holds — even if only ciphertext — every user's vault); mnemonic-only recovery
(recovers the identity but not the non-derivable circle AES keys, so it cannot fully restore circles on its
own).

## Threat model

The backup file is AES-GCM-encrypted under a key derived from the user's passphrase (PBKDF2). An attacker
who obtains the file but not the passphrase gets only ciphertext; a wrong passphrase fails the GCM
authentication tag. The on-device vault retains the Layer 1 posture (encrypted at rest under a
non-extractable wrap key; an active-session XSS can still ask the app to sign or to export, which is
inherent to any usable local key — unchanged from Layer 1). The passphrase is never persisted and never
leaves the device. There is no passphrase reset: a forgotten passphrase means the file is unrecoverable,
by design (the same property as a hardware-wallet seed).

## Part A — The v2 device vault

Layer 1 stored the secret key in the `sentinelmesh-identity` IndexedDB as a versioned record
`{ version: 1, blob }` where `blob = IV || AES-GCM(non-extractable wrap key, secretKey)`. Layer 2 evolves
the **decrypted** vault payload from "just the secret key" into a structured vault:

```
VaultPayload (v2) = {
  identitySk: Uint8Array(32),                          // the Nostr secret key
  circles:    Array<{ id: string; key: Uint8Array(32) }>, // raw circle AES keys + circle ids
}
```

Storage stays identical in spirit: the serialized `VaultPayload` is AES-GCM-encrypted under the
non-extractable wrap key and stored as `{ version: 2, blob }`. The vault is still **encrypted at rest** and
the wrap key is still non-extractable.

Export metadata (the last-exported fingerprint, Part D) is **not** part of `VaultPayload`. It is stored as a
**separate record** `vault-meta` in the same `sentinelmesh-identity` store — `{ lastExportedFingerprint:
string }` — so it travels with the device, never enters the exported file, and never has to be stripped out
of the payload before export. The fingerprint is a non-reversible SHA-256 of public/derived data, so it is
stored as a plain record (no secret material).

`identityStore.ts` gains payload-level helpers while keeping the Layer 1 API working:

- `loadVault(): Promise<VaultPayload | null>` — decrypt + parse the v2 payload; **migrates** a `{version:1}`
  record by reading it as `{ identitySk, circles: [] }` and rewriting it as `{version:2}` on first access.
- `saveVault(payload): Promise<void>` — serialize + encrypt + store as `{version:2}`.
- `upsertCircleKey(id, rawKey): Promise<void>` — load vault, add/replace the `{id, key}` entry, save. Used
  by `e2eeService` whenever a circle key is created/unwrapped (raw bytes in hand).
- `removeVaultCircle(id): Promise<void>` — drop a circle entry (mirrors `clearCircleKey`).
- `loadVaultMeta()` / `saveVaultMeta(meta)` — read/write the separate `vault-meta` record.
- The Layer 1 surface (`saveSecretKey`, `loadSecretKey`, `loadOrCreateSecretKey`, `clearSecretKey`) is
  reimplemented in terms of the vault: `loadSecretKey` returns `vault.identitySk`; `saveSecretKey` updates
  `identitySk` preserving `circles`. The versioned-envelope, wrap-key, and Web-Locks-serialized
  get-or-create behavior from Layer 1 are retained unchanged.

Serialization: `identitySk` and each `key` are fixed 32-byte arrays; serialize the payload as JSON with the
byte arrays base64-encoded (a small helper), so the structured-clone/`Uint8Array` round-trip is explicit and
version-stable. The exported file contains the serialized `VaultPayload` only — `identitySk` + `circles`,
never `vault-meta`.

## Part B — Capturing raw circle keys into the vault (`e2eeService`)

Circle keys must stay **non-extractable** in the live `sentinelmesh` IndexedDB (the C-3 / e2ee posture: an
XSS cannot export them). Layer 2 adds a parallel, backup-only copy of the **raw** key bytes into the device
vault. The single capture point is a new helper:

- **`saveCircleKeyWithBackup(circleId, rawKey: Uint8Array): Promise<void>`** — imports `rawKey`
  **non-extractably** into the live `sentinelmesh` store (same as `saveCircleKey` does today) **and** calls
  `identityStore.upsertCircleKey(circleId, rawKey)` to record the raw bytes in the vault, then zeroes the
  caller's raw buffer. This is the one function both circle-key origin flows route through, because both
  legitimately hold the raw bytes at that moment:
  - **Create** (owner generates a circle key): `generateCircleKey()` returns an extractable key; the create
    flow `exportKey('raw', ...)` it once to get the bytes, passes them to `saveCircleKeyWithBackup`, and
    wraps for members from the same extractable key.
  - **Join** (member unwraps): `unwrapCircleKey()` already decrypts the wrapped key to raw bytes internally;
    the join flow obtains those raw bytes and passes them to `saveCircleKeyWithBackup`.
- The existing `saveCircleKey(circleId, key: CryptoKey)` is retained unchanged for any path that only has a
  `CryptoKey` (it does **not** write the vault, since a non-extractable `CryptoKey` cannot be exported); new
  Layer 2 call sites use `saveCircleKeyWithBackup` so the vault copy is always captured.
- `clearCircleKey(circleId)` also calls `removeVaultCircle(circleId)` so a removed circle leaves no stale
  vault entry.
- `rotateCircleKey(circleId)` generates a fresh key and persists via `saveCircleKeyWithBackup` (exporting the
  fresh extractable key's raw bytes), so the vault always holds the current key — and the staleness
  fingerprint changes (Part D).

The vault copy is **never** read for live encryption/decryption — live crypto continues to use the
non-extractable `CryptoKey` in the `sentinelmesh` store. The vault copy exists solely to feed export and to
seed a restore.

## Part C — Export and import (`backupService`)

A new `apps/pwa/src/services/backupService.ts` owns the file format and the passphrase crypto. It depends on
`identityStore` (for `loadVault`/`saveVault`) and `e2eeService` (to fan restored keys back into the live
store), and is consumed only by `SettingsPage`.

**File format** (a versioned envelope, JSON, written as a downloaded Blob):

```
BackupFile = {
  format: "sentinelmesh-vault-backup",
  version: 1,
  kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: <base64 16 bytes> },
  iv: <base64 12 bytes>,
  ciphertext: <base64>,   // AES-GCM( JSON.stringify(serialized VaultPayload) )
}
```

**KDF:** PBKDF2-HMAC-SHA256, 600,000 iterations, random 16-byte salt per export — native to WebCrypto, no
new dependency. (Argon2id was considered and rejected for Layer 2: stronger memory-hardness but requires a
WASM library, added bundle weight, and supply-chain surface not justified for the pilot. The `kdf` object
in the envelope is the forward seam to swap algorithms later.)

**`exportBackup(passphrase): Promise<Blob>`**
1. `loadVault()` → the current `VaultPayload`.
2. Generate a random 16-byte salt + 12-byte IV; derive an AES-GCM-256 key via
   `PBKDF2(passphrase, salt, 600000, SHA-256)`.
3. AES-GCM-encrypt the serialized payload; assemble the `BackupFile`; return it as a
   `application/json` Blob. `SettingsPage` triggers the download via an object URL.
4. Record `lastExportedFingerprint` (Part D) via `saveVaultMeta`, and return the Vault ID
   (`formatVaultId` of that fingerprint) alongside the Blob so the export screen can display it.

**`importBackup(file: string | object, passphrase): Promise<RestoreResult>`**
1. Parse + validate `format === "sentinelmesh-vault-backup"` and a known `version`; reject otherwise with a
   precise error.
2. Re-derive the key from `passphrase` + the file's `kdf.salt`/`iterations`; AES-GCM-decrypt with `iv`. A
   wrong passphrase or any tampering fails the GCM auth tag → throw a single generic
   `"Incorrect passphrase or corrupted backup file"` (wrong-passphrase and corruption are intentionally
   indistinguishable).
3. Parse the decrypted `VaultPayload`. Then fan out:
   - identity: `saveSecretKey(payload.identitySk)` (Layer 1 persistence path) + refresh the in-memory
     `_keypair` so the running app immediately uses the restored identity.
   - circles: for each `{id, key}`, `e2eeService.saveCircleKeyWithBackup(id, key)` (live non-extractable
     import + vault upsert) and `circleIdStore.addCircleId(id)`.
4. Return `{ vaultId: string, identityRestored: true, circlesRestored: n, circlesFailed: string[] }` —
   `vaultId` is `formatVaultId(fingerprintPayload(decryptedPayload))`, computed from the decrypted payload so
   the UI can show it before the user confirms the restore. Restore is identity-first (atomic; if identity
   restore throws, abort before touching circles) then best-effort per-circle, reporting any individual
   circle that failed so the UI can tell the user precisely.

To support showing the Vault ID **before** the destructive write, `importBackup` is split: a pure
`decryptBackup(file, passphrase): Promise<{ payload, vaultId }>` (parse + decrypt + fingerprint, no writes)
and `applyRestore(payload): Promise<RestoreResult>` (the fan-out write). `SettingsPage` calls `decryptBackup`,
shows the Vault ID in the confirm step, then calls `applyRestore` on confirm.

Import is a **full restore that replaces** the device's current identity (e.g., the auto-generated
first-boot key from Layer 1). `SettingsPage` confirms this destructive replacement before importing.

## Part D — Staleness indicator

A point-in-time backup goes stale when the vault changes (a circle is joined, a key rotates, the identity is
reset). The vault tracks a **fingerprint** so the UI can nudge a re-export:

- `fingerprintPayload(payload): Promise<string>` — `SHA-256` hex over `pubkey || "\n" || sorted(circleId +
  ":" + sha256(key))` for every circle in the `VaultPayload`. Deterministic and order-independent. Pure over
  a payload so the same function fingerprints the live vault **and** a just-decrypted import.
- `vaultFingerprint(): Promise<string>` — `fingerprintPayload(loadVault())`.

### Vault ID (human verification)

`formatVaultId(fingerprint): string` renders the first 48 bits (12 hex chars) of a fingerprint as an
uppercase, hyphen-grouped **Vault ID**, e.g. `8A4C-12F7-9D21`. It is a short checksum of the vault contents,
**not** a secret: it is a truncated one-way SHA-256 of the *public* pubkey plus per-circle key *hashes*, so
it exposes no key material and cannot be reversed. Because it is deterministic over the vault contents, the
same backup always shows the same Vault ID.

Display:
- **Export screen:** show the current vault's Vault ID (`formatVaultId(vaultFingerprint())`) so the user can
  note which backup they just made.
- **Import screen:** after a successful decrypt, compute `formatVaultId(fingerprintPayload(importedPayload))`
  and show it, so the user can confirm it matches the Vault ID they expected before committing the
  destructive restore.

This lets a user verify they imported the correct backup file without ever revealing a secret.
- On `exportBackup`, store `lastExportedFingerprint = vaultFingerprint()` via
  `saveVaultMeta(...)` — the separate `vault-meta` record from Part A.
- `SettingsPage` computes the current fingerprint and compares against `loadVaultMeta()`:
  - no `lastExportedFingerprint` → "You have no backup yet — export one to protect your identity."
  - differs from current → amber "⚠ Backup out of date — re-export" badge by the Export button.
  - matches → no badge (a quiet "Backup up to date" confirmation is acceptable).

The fingerprint lives only in the on-device `vault-meta` record, never in the exported file, so two devices
can't fight over it and an exported file reveals nothing about export history.

## Part E — SettingsPage UI

Extend the existing Identity section (Layer 1 already shows npub/nsec, import-nsec, reset, and the
no-recovery warning). Layer 2:

- **Replaces** the Layer 1 "there is no recovery yet" warning with a **Backup & Recovery** subsection.
- **Export backup:** a button → passphrase prompt (enter + confirm, min 12 chars, with a clear "there is no
  way to recover this passphrase; store it safely" warning) → downloads `sentinelmesh-backup.json` → shows
  the **Vault ID** (`8A4C-12F7-9D21`) of the exported vault with a "note this to verify your backup later"
  hint.
- **Import backup:** a file picker → passphrase prompt → `decryptBackup` → a confirm step that shows the
  imported file's **Vault ID** and warns "this will replace your current identity on this device" → on
  confirm, `applyRestore` → success/partial/failure message (including any circles that failed).
- **Staleness badge** by the Export button per Part D.
- Buttons disabled until the Layer 1 async identity load has resolved (same gating pattern as Layer 1).

## Part F — Error handling

- Non-JSON / oversized / wrong-`format` / unknown-`version` file → rejected before any decryption with a
  precise message; never attempt to decrypt an unrecognized envelope.
- Wrong passphrase or tampered ciphertext → GCM auth-tag failure → single generic error (no oracle on
  which of the two it was).
- Export when `crypto.subtle` / storage is unavailable (e.g., non-secure context) → Export disabled with a
  shown reason.
- Partial restore: identity restore is attempted first and aborts the whole import on failure; circle
  restore is best-effort per circle, and the UI reports the count restored plus any failed ids.
- A v1 vault on disk migrates to v2 transparently on first `loadVault`; a v2 vault on an older build (no
  forward path needed for Layer 2) is out of scope.

## Part G — Testing

PWA (vitest), mocking IndexedDB + WebCrypto as the existing `e2eeService.test.ts` / `identityStore.test.ts`
do:

- **identityStore v2:** `{version:1}` record migrates to a v2 vault with empty `circles` and round-trips;
  `saveVault`/`loadVault` round-trip identity + N circles exactly; `upsertCircleKey` adds then replaces by
  id; `removeVaultCircle` drops; Layer 1 `saveSecretKey`/`loadSecretKey` still work against the v2 vault
  (preserving `circles`).
- **e2eeService capture:** after `saveCircleKeyWithBackup(id, raw)`, the live key is present and
  **non-extractable** (`key.extractable === false`) AND the vault holds the matching raw bytes;
  `clearCircleKey` removes the vault entry; `rotateCircleKey` updates the vault to the new key.
- **backupService round-trip:** `exportBackup(pass)` → `importBackup(blobText, pass)` restores the exact
  identity SK + every circle id/key; wrong passphrase throws the generic error; a one-byte-tampered
  ciphertext throws; unknown `format`/`version` rejected; the exported envelope contains no plaintext key
  material (assert the ciphertext does not contain the raw identity bytes).
- **fingerprint / staleness:** `vaultFingerprint` changes when a circle is added or a key rotated, and
  matches again after re-export; `lastExportedFingerprint` is set by `exportBackup` and lives only in the
  vault (absent from the exported file).
- **Vault ID:** `formatVaultId` returns the `XXXX-XXXX-XXXX` form (12 uppercase hex, two hyphens); the Vault
  ID from `exportBackup` equals the `vaultId` from `decryptBackup` of that same file (stable across
  round-trip); it changes when the vault contents change; and it contains no raw key bytes (assert it is
  derived only from the fingerprint).

## Rollout

- Pure PWA change. No server change, no new env var, no migration (the v1→v2 vault migration is client-side
  and automatic on first load). NIP-07 users are unaffected (no local key to back up; documented).
- After deploy, users can export a self-custodial encrypted backup and restore their full identity +
  circles on a new device; the staleness badge nudges them to keep the backup current.

## Non-goals (future)

- Server-assisted, cloud, or automatic backup; any server-held copy of the vault.
- Social / Shamir recovery across circle members.
- Re-wrap-from-member recovery for a circle key that **rotated after** the last backup: the restored user is
  still recognized as a member server-side (deterministic token) but holds a stale key and cannot decrypt
  post-rotation blobs until re-invited. Documented as a known limitation; a future "request re-key from a
  member" flow would close it.
- Changing the passphrase of an existing backup file (re-export with a new passphrase is the workaround).
- Reconciling the pre-existing NIP-07-vs-local-key signing inconsistency (carried over from Layer 1).
