# H-3 Layer 1 — Persistent Identity (Design)

Date: 2026-06-07
Audit ref: H-3 ("Identity is ephemeral by default; no recovery"), FINAL-audit-report.md
Branch goal: stop the silent regeneration of the user's Nostr identity so it persists across page
reloads as the **same pubkey**, encrypted at rest, with zero friction. Device-loss / cross-device
recovery is **Layer 2** (a separate later spec) and is explicitly out of scope here.

## Problem

`apps/pwa/src/services/nostrService.ts` keeps the Nostr secret key **in memory only**
(`_ephemeralKeypair`) and regenerates it on every page reload (`getOrCreateEphemeralKeypair`). Even
`importFromNsec` stores the imported key in memory only. So a user without a NIP-07 browser
extension gets a **brand-new pubkey on every refresh**, which silently:

- orphans their family-circle membership (they are no longer the pubkey that owns/joined the circle),
- resets their community-report reputation/tier,
- breaks any attribution tied to their key.

`apps/pwa/src/pages/SettingsPage.tsx` compounds this: it tells the user their key is "generated and
**stored locally on this device**" (false), shows an nsec to "back up" (useless — it changes next
refresh), and offers an Import that does not persist. The UI actively misrepresents the state.

For a public-safety pilot this is a silent data-loss bug: the very networks the product builds
(circles, reputation) evaporate on refresh.

## Goal

Persist the Nostr identity locally, **encrypted at rest**, so that:

1. The same pubkey is used across reloads and sessions (no silent regeneration).
2. The secret key is never stored in plaintext (it is AES-GCM-encrypted under a non-extractable
   device key, mirroring the existing circle-key custody in `e2eeService`).
3. Importing an nsec persists it (a restored key survives refresh).
4. Regenerating the identity is only ever an **explicit, confirmed** user action.
5. The `SettingsPage` messaging is honest: the key is now stored locally, **and** there is no
   device-loss recovery yet — losing this device loses the identity until Layer 2 ships.

## Non-goals (Layer 2 / later)

- Device-loss / cross-device / new-device recovery.
- Whole-vault backup/restore (Nostr key **+** circle AES keys **+** circle IDs). Layer 1 persists
  only the Nostr identity; circle keys and IDs are already persisted on-device today, so the
  same-device case is fully fixed by Layer 1, but a *new* device still needs Layer 2.
- Optional passphrase encryption (NIP-49). Layer 1 is frictionless device-key only.
- Social / server-assisted recovery or key escrow.

## Threat model (chosen)

At rest, the secret key is AES-GCM-encrypted under a **non-extractable** AES key held in IndexedDB.
This defends against: a stolen device *file*/DB copy (yields only ciphertext), and XSS *exfiltration*
of the long-term key (the wrapping key cannot be exported). It does **not** defend against an XSS
that runs in an active session (it can ask the app to decrypt and sign — inherent to any usable
local signing key) — that is the same exposure as today and as the circle keys. No passphrase, by
design (Layer 1 prioritizes zero friction for non-technical pilot users).

## Part A — Identity store (new)

A small module — `apps/pwa/src/services/identityStore.ts` — persists the raw 32-byte Nostr secret
key encrypted under a non-extractable device key, in IndexedDB. It reuses the same IndexedDB +
base64 envelope approach already in `e2eeService.ts` (`openKeyDb`, `idbPut`/`idbGet`,
`encodeB64`/`decodeB64`); factor those out or mirror them so both stores share one IndexedDB
database, in a new `identity` object store.

Two records:
- `identity-wrap-key`: a **non-extractable** `AES-GCM` `CryptoKey` (`generateKey(..., extractable:
  false, ['encrypt','decrypt'])`), generated once and stored via the structured-clone-able CryptoKey
  path (IndexedDB stores `CryptoKey` objects directly, as the circle-key store already does).
- `nostr-sk`: a **versioned vault envelope** `{ version: 1, blob }` where `blob = IV || AES-GCM(wrap-key,
  rawSecretKey)`. The `version` field is the forward seam for Layer 2 (NIP-49 passphrase wrapping,
  passkeys, encrypted exports, consolidating circle IDs) — `loadSecretKey` rejects any version it does
  not understand, so those become clean v1→vN migrations rather than a redesign. (Circle IDs are NOT
  moved into the vault in Layer 1 — they already persist reliably in `circleIdStore`; consolidation is
  a Layer-2 migration.)

API (all async):
- `saveSecretKey(sk: Uint8Array): Promise<void>` — load-or-create the wrap key, AES-GCM-encrypt `sk`,
  store the versioned envelope.
- `loadSecretKey(): Promise<Uint8Array | null>` — load the wrap key + envelope; check the version;
  decrypt; return the raw bytes, or `null` if absent / unknown version / decryption fails.
- `loadOrCreateSecretKey(generate): Promise<Uint8Array>` — **concurrency-safe** get-or-create:
  serialized across tabs via the Web Locks API (with a graceful fallback when unavailable) plus a
  post-create re-read, so two tabs booting with an empty vault converge on a single identity instead
  of racing to generate different keys. (Crypto cannot run inside an IndexedDB transaction without
  auto-committing it, so a Web Lock — not a single IDB transaction — is the cross-tab guard.)
- `clearSecretKey(): Promise<void>` — delete the `nostr-sk` record (used by the explicit reset).

The wrap key is created lazily inside `saveSecretKey` and reused; `loadSecretKey` returns `null` if no
key has ever been saved. `nostrService.loadIdentity` additionally holds an **in-process init promise**
so concurrent callers within one tab (e.g. React StrictMode's double-invoke) share a single
initialization.

## Part B — `nostrService` refactor (the core fix)

Replace the in-memory-ephemeral model with a persisted, session-cached one.

- **Module cache:** `let _keypair: NostrKeypair | null` holds the decrypted identity for the session
  (decrypt once at boot, hold in memory — an in-session XSS could read it on the next sign either
  way, so per-sign decrypt-and-zero is deferred as future hardening).
- **`loadIdentity(): Promise<NostrKeypair>`** — the single entry point, idempotent:
  - If NIP-07 is present (`hasNip07()`), return the extension-backed identity: the pubkey from
    `window.nostr.getPublicKey()` and **no local secret key** (the extension owns it). The signing
    helpers already branch on `hasNip07()` at call time and route to the extension, so no local key
    is persisted or cached for these users. (`NostrKeypair.secretKey` becomes optional — present for
    the local path, absent for NIP-07 — or a small `{ publicKey; secretKey?: Uint8Array }` view; the
    plan pins the exact type.)
  - Else: if `_keypair` is cached, return it. Otherwise `loadSecretKey()`:
    - present → derive the pubkey, cache, return.
    - absent → `generateSecretKey()` **once**, `saveSecretKey(sk)`, cache, return.
  - **Invariant: this never regenerates an identity when a persisted (or cached) key exists.**
- **`importFromNsec(nsec): Promise<NostrKeypair | null>`** — decode the nsec; on success
  `await saveSecretKey(sk)`, update the cache, return the keypair. (Now persists; today it does not.)
- **`generateNewIdentity(): Promise<NostrKeypair>`** — the only path that overwrites an existing
  identity: `generateSecretKey()`, `saveSecretKey`, update cache, return. Callers must confirm with
  the user first (Settings does).
- **Signing** (`signEventAsync`, `signAuthEvent`, `signNip98AuthEvent`, `signReport`,
  `getPublicKeyAsync`) read the cached identity (NIP-07 branch unchanged). Add a guard so a sign
  before `loadIdentity()` has resolved awaits/triggers initialization rather than minting an
  ephemeral key.
- **Remove** `getOrCreateEphemeralKeypair` and the sync `loadOrCreateKeypair` "ephemeral, lost on
  refresh" behavior. Keep `clearStoredKey()` (legacy `sentinel_nostr_sk` localStorage cleanup) and
  the encoders (`toNpub`/`toNsec`/`hexFromNpubOrHex`/binding helpers) as-is.

## Part C — App boot

Await `loadIdentity()` early in app startup (e.g. in `App`/`main` before the authenticated views
mount), so the cached identity is ready before any code needs to sign. A brief loading state covers
the async init; signing helpers also self-initialize (Part B guard) so there is no race.

## Part D — `SettingsPage` (make it honest and functional)

- Load the identity via the async `loadIdentity()` (replace the synchronous module-load
  `let _keypair = loadOrCreateKeypair()` with an effect that resolves the keypair).
- **Import** routes through the now-persisting `importFromNsec` (await), and on success the displayed
  npub/nsec reflect the persisted key.
- **"Generate new key (resets identity)"** routes through `generateNewIdentity()` after the existing
  `window.confirm`, and persists.
- **Honest copy:** the existing "stored locally on this device" line becomes true. Add a clear
  warning block: *there is no recovery yet — if you lose this device you lose this identity (and your
  circles); save your secret key (nsec) somewhere safe as a backup.* The existing nsec reveal/copy is
  the interim manual backup until Layer 2 ships proper recovery.

## Part E — Migration / compatibility

No data migration: nothing is persisted today (all identities are already ephemeral and lost on
refresh), so there is no prior stable identity to preserve. After the update, the first load
generates and persists a stable key. A user who had a circle under their current *ephemeral* pubkey
will get a new persisted pubkey and that pre-update membership is orphaned — but that membership was
already going to vanish on the next refresh, so this is not a regression; going forward the identity
is stable. The legacy `sentinel_nostr_sk` localStorage cleanup remains.

## Part F — Testing

PWA (vitest):
- **identityStore:** `saveSecretKey` then `loadSecretKey` round-trips the exact 32 bytes;
  `loadSecretKey` on an empty store returns `null`; the wrap key is non-extractable
  (`key.extractable === false`); `clearSecretKey` makes a subsequent `loadSecretKey` return `null`.
- **nostrService:** two `loadIdentity()` calls return the **same** pubkey; clearing the in-memory
  cache but keeping IndexedDB (simulating a reload) still returns the **same** pubkey (no
  regeneration); `importFromNsec` persists (load after import returns the imported pubkey);
  `generateNewIdentity` changes the pubkey and persists the new one; the NIP-07 path returns the
  extension pubkey and does not write to the identity store.
- Mock IndexedDB + WebCrypto as the existing `e2eeService.test.ts` does (the test environment already
  exercises `crypto.subtle` and IndexedDB for the circle-key store).

## Rollout

- Frictionless: no new env var, no passphrase, no server change. Pure PWA change.
- After deploy, non-NIP-07 users get a stable, encrypted-at-rest identity on first load; NIP-07 users
  are unchanged.
- `SettingsPage` honestly states the new persistence **and** the remaining device-loss gap, pointing
  at the interim nsec backup until Layer 2.
- Forward-compatible seam for Layer 2: the `identityStore` is the place a whole-vault export/restore
  (identity + circle keys + circle IDs) and/or an optional passphrase layer will build on.
