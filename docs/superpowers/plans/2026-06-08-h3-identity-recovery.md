# H-3 Layer 2 — Identity Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user export a self-custodial, passphrase-encrypted backup of their full identity (Nostr key + circle AES keys + circle IDs) and restore it on a new device, with a human-verifiable Vault ID and a staleness nudge.

**Architecture:** The Layer 1 `sentinelmesh-identity` vault grows from "just the secret key" into a structured **v2 vault payload** `{ identitySk, circles: [{id, key}] }`, still encrypted at rest under the non-extractable device wrap key. `e2eeService` captures the raw circle-key bytes into the vault at the (only) live save sites — circle create and key rotation — while the live E2EE store keeps non-extractable keys. A new `backupService` serializes the vault, encrypts it under a PBKDF2-derived key into a versioned file envelope, and restores it by fanning the decrypted payload back into the vault, the live circle-key store, and `circleIdStore`. `SettingsPage` gains Export/Import with a Vault ID and a staleness badge.

**Tech Stack:** TypeScript/React PWA, WebCrypto (AES-GCM, PBKDF2), IndexedDB, `nostr-tools`, vitest + tsc. Tests mock IndexedDB + `crypto.subtle` the same way the existing `e2eeService.test.ts` / `identityStore.test.ts` do (jsdom env + `fake-indexeddb`, or node env + `fake-indexeddb/auto` — match the file you are editing).

**Spec:** `docs/superpowers/specs/2026-06-08-h3-identity-recovery-design.md`.

**Conventions:**
- Commit messages: plain English, NO `Co-Authored-By` trailer.
- PWA commands: `cd apps/pwa && npx vitest run <files>` and `npx tsc --noEmit`.
- Branch: `feat/h3-identity-recovery`.

**Codebase facts the implementer must know:**
- Layer 1 `identityStore.ts` already exists. It stores the secret key as IDB record `nostr-sk = { version: 1, blob }`, `blob = IV(12) || AES-GCM(non-extractable wrapKey, sk)`. It has lock-free internals (`getOrCreateWrapKey`, `saveSecretKeyUnlocked`) and public mutators wrapped in `withInitLock(...)` (the `sentinelmesh-identity-init` Web Lock; **not reentrant** — never nest). Public API: `saveSecretKey`, `loadSecretKey`, `loadOrCreateSecretKey(generate)`, `clearSecretKey`.
- `e2eeService.ts` stores circle keys **non-extractable** in a separate IDB DB `sentinelmesh` / store `circle_keys`, keyed by circleId. `saveCircleKey(circleId, key)` downgrades to non-extractable via `toNonExtractable`. `generateCircleKey()` returns an **extractable** key. `rotateCircleKey(circleId)` = generate + save + return the fresh extractable key. `clearCircleKey(circleId)` deletes it.
- The **only live circle-key save sites** are `FamilyCircleDashboard.tsx:112` (create) and `e2eeService.ts:113` (rotate). The invite/join flow (`FamilyCircleDashboard.tsx:302`) only calls `addCircleId` — there is no join-time key save, so there is nothing extra to capture there.
- `circleIdStore.ts`: sync `getCircleIds()/addCircleId(id)/removeCircleId(id)` over `localStorage`.
- `nostrService.ts`: `loadIdentity()`, `getCachedKeypair()`, `importFromNsec(nsec)` (async, persists), `generateNewIdentity()`, `__resetIdentityCacheForTests()`, encoders `toNsec`/`toNpub`. Module caches `_keypair` + `_initPromise`.

---

### Task 1: `identityStore` v2 vault payload + migration (TDD)

**Files:**
- Modify: `apps/pwa/src/services/identityStore.ts`
- Modify: `apps/pwa/src/services/__tests__/identityStore.test.ts`

Evolve the decrypted vault from a bare secret key into `{ identitySk, circles }`, migrate v1→v2, and reimplement the Layer 1 API on top of the vault. Circle helpers + fingerprint come in Task 2. **Read `identityStore.ts` first.**

- [ ] **Step 1: Write the failing tests**

Add to `apps/pwa/src/services/__tests__/identityStore.test.ts` (keep the existing Layer 1 tests; add new imports + a new describe):

```ts
import { loadVault, saveVault, encodeVaultPayload, decodeVaultPayload, type VaultPayload } from '../identityStore'

function sk(n: number): Uint8Array {
  const k = new Uint8Array(32)
  for (let i = 0; i < 32; i++) k[i] = (i * 13 + n) & 0xff
  return k
}

describe('identityStore v2 vault', () => {
  beforeEach(async () => { await clearSecretKey() })

  it('encode/decode round-trips a payload with circles', () => {
    const payload: VaultPayload = { identitySk: sk(1), circles: [{ id: 'c-1', key: sk(2) }, { id: 'c-2', key: sk(3) }] }
    const decoded = decodeVaultPayload(encodeVaultPayload(payload))
    expect(Array.from(decoded.identitySk)).toEqual(Array.from(sk(1)))
    expect(decoded.circles.map(c => c.id)).toEqual(['c-1', 'c-2'])
    expect(Array.from(decoded.circles[1]!.key)).toEqual(Array.from(sk(3)))
  })

  it('saveVault then loadVault round-trips identity + circles', async () => {
    await saveVault({ identitySk: sk(5), circles: [{ id: 'c-9', key: sk(6) }] })
    const v = await loadVault()
    expect(v).not.toBeNull()
    expect(Array.from(v!.identitySk)).toEqual(Array.from(sk(5)))
    expect(v!.circles).toHaveLength(1)
    expect(v!.circles[0]!.id).toBe('c-9')
    expect(Array.from(v!.circles[0]!.key)).toEqual(Array.from(sk(6)))
  })

  it('loadVault returns null when nothing is stored', async () => {
    expect(await loadVault()).toBeNull()
  })

  it('Layer 1 saveSecretKey writes a v2 vault; loadSecretKey reads it back', async () => {
    await saveSecretKey(sk(7))
    expect(Array.from((await loadSecretKey())!)).toEqual(Array.from(sk(7)))
    const v = await loadVault()
    expect(v!.circles).toEqual([])
  })

  it('saveSecretKey preserves existing circles', async () => {
    await saveVault({ identitySk: sk(1), circles: [{ id: 'keep', key: sk(2) }] })
    await saveSecretKey(sk(8)) // rotate identity only
    const v = await loadVault()
    expect(Array.from(v!.identitySk)).toEqual(Array.from(sk(8)))
    expect(v!.circles.map(c => c.id)).toEqual(['keep'])
  })

  it('migrates a legacy v1 record to a v2 vault with empty circles', async () => {
    // Write a raw v1 record exactly as Layer 1 did: { version: 1, blob }.
    await __writeLegacyV1ForTests(sk(4))
    const v = await loadVault()
    expect(Array.from(v!.identitySk)).toEqual(Array.from(sk(4)))
    expect(v!.circles).toEqual([])
    // And it is rewritten as v2 (a subsequent saveVault/loadVault is consistent).
    expect(Array.from((await loadSecretKey())!)).toEqual(Array.from(sk(4)))
  })
})
```

Add `__writeLegacyV1ForTests` to the import from `'../identityStore'` (a test-only helper you will add in Step 3).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/pwa && npx vitest run src/services/__tests__/identityStore.test.ts 2>&1 | tail -20
```
Expected: FAIL — `loadVault`/`saveVault`/`encodeVaultPayload`/`decodeVaultPayload`/`__writeLegacyV1ForTests` not exported.

- [ ] **Step 3: Implement the v2 vault in `identityStore.ts`**

Bump the envelope version and add the payload model. Replace the `VAULT_VERSION`/`VaultRecord` block and the Layer 1 secret-key functions as follows (keep `DB_*`, `WRAP_KEY_ID`, `SK_ID`, `openDb`, `idbGet`, `idbPut`, `idbDelete`, `withInitLock`, `getOrCreateWrapKey` unchanged):

```ts
// v1 stored only the raw secret key. v2 stores a structured vault payload so a
// backup can carry the identity AND the circle keys + ids. loadVault migrates a
// v1 record to v2 on first read.
const VAULT_VERSION = 2

export interface VaultCircle { id: string; key: Uint8Array }      // raw 32-byte AES key
export interface VaultPayload { identitySk: Uint8Array; circles: VaultCircle[] }

interface VaultRecord { version: number; blob: Uint8Array } // blob = IV || AES-GCM(wrapKey, serialized payload)

// ── Payload serialization (JSON with base64 byte arrays, version-stable) ──────
function b64encode(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)) }
function b64decode(s: string): Uint8Array { return Uint8Array.from(atob(s), c => c.charCodeAt(0)) }

export function encodeVaultPayload(p: VaultPayload): string {
  return JSON.stringify({
    identitySk: b64encode(p.identitySk),
    circles: p.circles.map(c => ({ id: c.id, key: b64encode(c.key) })),
  })
}

export function decodeVaultPayload(json: string): VaultPayload {
  const o = JSON.parse(json) as { identitySk: string; circles: Array<{ id: string; key: string }> }
  return {
    identitySk: b64decode(o.identitySk),
    circles: (o.circles ?? []).map(c => ({ id: c.id, key: b64decode(c.key) })),
  }
}
```

Add the vault read/write internals + public API (lock-free internals, public mutators take the lock once — mirror the Layer 1 pattern, never nest the lock):

```ts
// Lock-free: encrypt + store a full v2 payload. Call only under the init lock.
async function saveVaultUnlocked(payload: VaultPayload): Promise<void> {
  const wrapKey = await getOrCreateWrapKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(encodeVaultPayload(payload))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, plaintext as unknown as BufferSource)
  const blob = new Uint8Array(iv.byteLength + ciphertext.byteLength)
  blob.set(iv); blob.set(new Uint8Array(ciphertext), iv.byteLength)
  await idbPut(SK_ID, { version: VAULT_VERSION, blob } as VaultRecord)
}

/** Decrypt + parse the vault. Migrates a legacy v1 record (raw secret key) to a
 *  v2 payload with empty circles, rewriting it as v2. Returns null if absent or
 *  undecryptable. */
export async function loadVault(): Promise<VaultPayload | null> {
  try {
    const wrapKey = await idbGet<CryptoKey>(WRAP_KEY_ID)
    const rec = await idbGet<VaultRecord>(SK_ID)
    if (!wrapKey || !rec || !rec.blob || rec.blob.byteLength < 28) return null
    const iv = rec.blob.slice(0, 12)
    const data = rec.blob.slice(12)
    const plain = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource }, wrapKey, data as unknown as BufferSource,
    ))
    if (rec.version === 1) {
      // v1 plaintext is the raw 32-byte secret key.
      const payload: VaultPayload = { identitySk: plain, circles: [] }
      await withInitLock(() => saveVaultUnlocked(payload)) // rewrite as v2
      return payload
    }
    if (rec.version !== VAULT_VERSION) return null
    return decodeVaultPayload(new TextDecoder().decode(plain))
  } catch {
    return null
  }
}

/** Encrypt + store a full vault payload (serialized cross-tab under the lock). */
export async function saveVault(payload: VaultPayload): Promise<void> {
  return withInitLock(() => saveVaultUnlocked(payload))
}
```

Reimplement the Layer 1 secret-key API on top of the vault (replace the old `saveSecretKeyUnlocked`/`saveSecretKey`/`loadSecretKey`/`loadOrCreateSecretKey` bodies; delete the old 60-byte raw-key path):

```ts
// Lock-free: set identitySk preserving existing circles. Call only under the lock.
async function saveSecretKeyUnlocked(sk: Uint8Array): Promise<void> {
  const current = await loadVault()
  await saveVaultUnlocked({ identitySk: sk, circles: current?.circles ?? [] })
}

/** Persist the Nostr secret key into the vault, preserving any circle entries. */
export async function saveSecretKey(sk: Uint8Array): Promise<void> {
  return withInitLock(() => saveSecretKeyUnlocked(sk))
}

/** Return the stored Nostr secret key, or null. (Reads vault.identitySk.) */
export async function loadSecretKey(): Promise<Uint8Array | null> {
  const v = await loadVault()
  return v ? v.identitySk : null
}

/** Get-or-create the identity secret key (boot path). Concurrency-safe. */
export async function loadOrCreateSecretKey(generate: () => Uint8Array): Promise<Uint8Array> {
  return withInitLock(async () => {
    const existing = await loadVault()
    if (existing) return existing.identitySk
    const sk = generate()
    await saveSecretKeyUnlocked(sk)
    return (await loadVault())?.identitySk ?? sk
  })
}

/** Delete the whole vault record (explicit identity reset). */
export async function clearSecretKey(): Promise<void> {
  await idbDelete(SK_ID)
}

/** Test-only: write a legacy v1 record (raw secret key) to exercise migration. */
export async function __writeLegacyV1ForTests(sk: Uint8Array): Promise<void> {
  await withInitLock(async () => {
    const wrapKey = await getOrCreateWrapKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, sk as unknown as BufferSource)
    const blob = new Uint8Array(iv.byteLength + ct.byteLength)
    blob.set(iv); blob.set(new Uint8Array(ct), iv.byteLength)
    await idbPut(SK_ID, { version: 1, blob } as VaultRecord)
  })
}
```

(Note: `loadVault`'s `blob.byteLength < 28` guard is the AES-GCM minimum — 12 IV + 16 tag — because the v2 payload length varies. The old `< 60` exact guard no longer applies.)

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/pwa && npx vitest run src/services/__tests__/identityStore.test.ts 2>&1 | tail -20
npx tsc --noEmit 2>&1 | grep identityStore; echo "ts-done"
```
Expected: PASS (existing Layer 1 tests + new v2 tests); no identityStore type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/services/identityStore.ts apps/pwa/src/services/__tests__/identityStore.test.ts
git commit -m "H-3 L2: v2 identity vault payload (identity + circles) with v1 migration"
```

---

### Task 2: `identityStore` circle helpers + fingerprint + Vault ID + meta (TDD)

**Files:**
- Modify: `apps/pwa/src/services/identityStore.ts`
- Modify: `apps/pwa/src/services/__tests__/identityStore.test.ts`

Add the circle-entry mutators the live store will call, the staleness fingerprint, the human Vault ID, and the separate export-metadata record.

- [ ] **Step 1: Write the failing tests**

Add to `identityStore.test.ts`:

```ts
import {
  upsertCircleKey, removeVaultCircle, loadVaultMeta, saveVaultMeta,
  fingerprintPayload, vaultFingerprint, formatVaultId,
} from '../identityStore'

describe('identityStore circle helpers + fingerprint', () => {
  beforeEach(async () => { await clearSecretKey() })

  it('upsertCircleKey adds, then replaces by id', async () => {
    await saveSecretKey(sk(1))
    await upsertCircleKey('c-1', sk(2))
    await upsertCircleKey('c-2', sk(3))
    await upsertCircleKey('c-1', sk(9)) // replace c-1
    const v = await loadVault()
    expect(v!.circles.map(c => c.id).sort()).toEqual(['c-1', 'c-2'])
    const c1 = v!.circles.find(c => c.id === 'c-1')!
    expect(Array.from(c1.key)).toEqual(Array.from(sk(9)))
    // identity preserved
    expect(Array.from(v!.identitySk)).toEqual(Array.from(sk(1)))
  })

  it('removeVaultCircle drops the entry', async () => {
    await saveSecretKey(sk(1))
    await upsertCircleKey('c-1', sk(2))
    await removeVaultCircle('c-1')
    expect((await loadVault())!.circles).toEqual([])
  })

  it('vaultFingerprint changes when a circle is added and is stable otherwise', async () => {
    await saveSecretKey(sk(1))
    const f0 = await vaultFingerprint()
    await upsertCircleKey('c-1', sk(2))
    const f1 = await vaultFingerprint()
    expect(f1).not.toBe(f0)
    expect(await vaultFingerprint()).toBe(f1) // stable
  })

  it('fingerprint is order-independent across circles', async () => {
    const a: VaultPayload = { identitySk: sk(1), circles: [{ id: 'a', key: sk(2) }, { id: 'b', key: sk(3) }] }
    const b: VaultPayload = { identitySk: sk(1), circles: [{ id: 'b', key: sk(3) }, { id: 'a', key: sk(2) }] }
    expect(await fingerprintPayload(a)).toBe(await fingerprintPayload(b))
  })

  it('formatVaultId returns XXXX-XXXX-XXXX uppercase hex from a fingerprint', async () => {
    const id = formatVaultId(await fingerprintPayload({ identitySk: sk(1), circles: [] }))
    expect(id).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/)
  })

  it('saveVaultMeta / loadVaultMeta round-trip and survive vault writes', async () => {
    await saveSecretKey(sk(1))
    await saveVaultMeta({ lastExportedFingerprint: 'abc123' })
    expect((await loadVaultMeta())?.lastExportedFingerprint).toBe('abc123')
    await upsertCircleKey('c-1', sk(2)) // vault write must not clobber meta
    expect((await loadVaultMeta())?.lastExportedFingerprint).toBe('abc123')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/pwa && npx vitest run src/services/__tests__/identityStore.test.ts 2>&1 | tail -20
```
Expected: FAIL — the new exports are missing.

- [ ] **Step 3: Implement the helpers in `identityStore.ts`**

Add the import at the top of the file (next to the other top-of-file code; `getPublicKey` derives the pubkey used in the fingerprint):

```ts
import { getPublicKey } from 'nostr-tools'
```

Add a constant near `SK_ID`:

```ts
const META_ID = 'vault-meta'
export interface VaultMeta { lastExportedFingerprint: string }
```

Add the helpers:

```ts
/** Add or replace a circle's raw key in the vault, preserving identity + others. */
export async function upsertCircleKey(circleId: string, rawKey: Uint8Array): Promise<void> {
  return withInitLock(async () => {
    const v = await loadVault()
    if (!v) return // no identity yet — nothing to attach a circle to
    const circles = v.circles.filter(c => c.id !== circleId)
    circles.push({ id: circleId, key: new Uint8Array(rawKey) })
    await saveVaultUnlocked({ identitySk: v.identitySk, circles })
  })
}

/** Remove a circle entry from the vault. */
export async function removeVaultCircle(circleId: string): Promise<void> {
  return withInitLock(async () => {
    const v = await loadVault()
    if (!v) return
    await saveVaultUnlocked({ identitySk: v.identitySk, circles: v.circles.filter(c => c.id !== circleId) })
  })
}

/** Read/write the separate, non-secret export-metadata record. */
export async function loadVaultMeta(): Promise<VaultMeta | null> { return idbGet<VaultMeta>(META_ID) }
export async function saveVaultMeta(meta: VaultMeta): Promise<void> { await idbPut(META_ID, meta) }

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Deterministic, order-independent fingerprint of a vault payload: SHA-256 of
 *  the public pubkey plus the sorted (circleId : sha256(key)) lines. Pure — used
 *  for both the live vault and a just-decrypted import. */
export async function fingerprintPayload(p: VaultPayload): Promise<string> {
  const pubkey = getPublicKey(p.identitySk)
  const lines = await Promise.all(p.circles.map(async c => `${c.id}:${await sha256Hex(c.key)}`))
  lines.sort()
  const material = new TextEncoder().encode(pubkey + '\n' + lines.join('\n'))
  return sha256Hex(material)
}

/** Fingerprint of the currently-stored vault (empty string if no vault). */
export async function vaultFingerprint(): Promise<string> {
  const v = await loadVault()
  return v ? fingerprintPayload(v) : ''
}

/** Short human-checkable Vault ID: first 48 bits of a fingerprint as XXXX-XXXX-XXXX. */
export function formatVaultId(fingerprint: string): string {
  const h = fingerprint.slice(0, 12).toUpperCase()
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/pwa && npx vitest run src/services/__tests__/identityStore.test.ts 2>&1 | tail -20
npx tsc --noEmit 2>&1 | grep identityStore; echo "ts-done"
```
Expected: PASS; no identityStore type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/services/identityStore.ts apps/pwa/src/services/__tests__/identityStore.test.ts
git commit -m "H-3 L2: vault circle helpers, staleness fingerprint, Vault ID, export meta"
```

---

### Task 3: `e2eeService` raw-key capture + wire the create flow (TDD)

**Files:**
- Modify: `apps/pwa/src/services/e2eeService.ts`
- Modify: `apps/pwa/src/services/__tests__/e2eeService.test.ts`
- Modify: `apps/pwa/src/components/FamilyCircleDashboard.tsx`

Add `saveCircleKeyWithBackup` (live non-extractable import + vault upsert), maintain the vault on clear/rotate, and route the one live create site through the new helper. **Read `e2eeService.ts` first.**

- [ ] **Step 1: Write the failing tests**

Add to `apps/pwa/src/services/__tests__/e2eeService.test.ts` (add `saveCircleKeyWithBackup`, `clearCircleKey`, `rotateCircleKey` to the imports from `'../e2eeService'`, and import vault readers):

```ts
import { saveCircleKeyWithBackup, clearCircleKey, rotateCircleKey, loadCircleKey } from '../e2eeService'
import { loadVault, saveSecretKey } from '../identityStore'

function rawKey(n: number): Uint8Array {
  const k = new Uint8Array(32); for (let i = 0; i < 32; i++) k[i] = (i + n) & 0xff; return k
}

describe('saveCircleKeyWithBackup (vault capture)', () => {
  beforeEach(async () => { await saveSecretKey(rawKey(99)) }) // a vault/identity must exist

  it('imports a non-extractable live key AND records raw bytes in the vault', async () => {
    await saveCircleKeyWithBackup('circle-A', rawKey(1))
    const live = await loadCircleKey('circle-A')
    expect(live).not.toBeNull()
    expect(live!.extractable).toBe(false)
    const v = await loadVault()
    const entry = v!.circles.find(c => c.id === 'circle-A')
    expect(entry).toBeTruthy()
    expect(Array.from(entry!.key)).toEqual(Array.from(rawKey(1)))
  })

  it('clearCircleKey removes the vault entry too', async () => {
    await saveCircleKeyWithBackup('circle-B', rawKey(2))
    await clearCircleKey('circle-B')
    expect(await loadCircleKey('circle-B')).toBeNull()
    expect((await loadVault())!.circles.find(c => c.id === 'circle-B')).toBeUndefined()
  })

  it('rotateCircleKey updates the vault to the new key', async () => {
    await saveCircleKeyWithBackup('circle-C', rawKey(3))
    const before = (await loadVault())!.circles.find(c => c.id === 'circle-C')!.key
    const fresh = await rotateCircleKey('circle-C')
    expect(fresh.extractable).toBe(true) // returned for re-wrapping
    const after = (await loadVault())!.circles.find(c => c.id === 'circle-C')!.key
    expect(Array.from(after)).not.toEqual(Array.from(before))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/pwa && npx vitest run src/services/__tests__/e2eeService.test.ts 2>&1 | tail -20
```
Expected: FAIL — `saveCircleKeyWithBackup` not exported.

- [ ] **Step 3: Implement in `e2eeService.ts`**

Add the import at the top:

```ts
import { upsertCircleKey, removeVaultCircle } from './identityStore'
```

Add the helper (place after `saveCircleKey`):

```ts
/**
 * Persist a circle key from its RAW bytes: import it non-extractably into the
 * live store (XSS cannot export it) AND record the raw bytes in the device vault
 * so the backup can carry it (H-3 Layer 2). The caller's rawKey buffer is zeroed.
 * Use this at every site that originates a circle key (create, rotate, restore).
 */
export async function saveCircleKeyWithBackup(circleId: string, rawKey: Uint8Array): Promise<void> {
  const liveKey = await crypto.subtle.importKey(
    'raw', rawKey as unknown as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
  )
  await idbPut(circleId, liveKey)
  if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_KEY_PREFIX + circleId)
  await upsertCircleKey(circleId, rawKey)
  new Uint8Array(rawKey.buffer, rawKey.byteOffset, rawKey.byteLength).fill(0)
}
```

Update `clearCircleKey` to also drop the vault entry:

```ts
export async function clearCircleKey(circleId: string): Promise<void> {
  await idbDelete(circleId)
  if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_KEY_PREFIX + circleId)
  await removeVaultCircle(circleId)
}
```

Update `rotateCircleKey` to capture into the vault (export the fresh key's raw bytes, persist via the backup-aware helper, return the still-extractable key for re-wrapping):

```ts
export async function rotateCircleKey(circleId: string): Promise<CryptoKey> {
  const fresh = await generateCircleKey() // extractable
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', fresh))
  await saveCircleKeyWithBackup(circleId, raw) // zeroes the raw copy; vault updated
  return fresh
}
```

(`saveCircleKeyWithBackup` zeroes the `raw` copy it is given; `fresh` remains a usable extractable `CryptoKey` for the caller to re-wrap.)

- [ ] **Step 4: Wire the create flow in `FamilyCircleDashboard.tsx`**

At line 112, replace `await saveCircleKey(raw.id, circleKey)` so the created key is captured into the vault. The create flow holds `circleKey` (extractable, from `generateCircleKey()`); export it and route through the new helper:

```tsx
      const rawCircleKey = new Uint8Array(await crypto.subtle.exportKey('raw', circleKey))
      await saveCircleKeyWithBackup(raw.id, rawCircleKey)
```

Update the import on line 6: replace `saveCircleKey` with `saveCircleKeyWithBackup`:

```tsx
import { generateCircleKey, saveCircleKeyWithBackup, loadCircleKey, encryptString } from '../services/e2eeService'
```

(`encryptString(circleKey, effectiveCircleName)` on line 103 still uses `circleKey` and runs before the save, so the export-after is fine.)

- [ ] **Step 5: Check the dashboard test mock**

```bash
cd apps/pwa && grep -n "saveCircleKey\|e2eeService" src/components/__tests__/FamilyCircleDashboard.test.tsx; echo "grep-done"
```
If the test mocks `e2eeService` and lists `saveCircleKey`, rename that mocked export to `saveCircleKeyWithBackup` (same `vi.fn()` stub). If `e2eeService` is not mocked there, no change.

- [ ] **Step 6: Run the tests + typecheck**

```bash
cd apps/pwa && npx vitest run src/services/__tests__/e2eeService.test.ts src/components/__tests__/FamilyCircleDashboard.test.tsx 2>&1 | tail -15
npx tsc --noEmit 2>&1 | grep -E "e2eeService|FamilyCircleDashboard"; echo "ts-done"
```
Expected: PASS; no type errors in those files.

- [ ] **Step 7: Commit**

```bash
git add apps/pwa/src/services/e2eeService.ts apps/pwa/src/services/__tests__/e2eeService.test.ts apps/pwa/src/components/FamilyCircleDashboard.tsx apps/pwa/src/components/__tests__/FamilyCircleDashboard.test.tsx
git commit -m "H-3 L2: capture raw circle keys into the vault at create/rotate; vault-aware clear"
```

---

### Task 4: `backupService` export / decrypt / restore (TDD)

**Files:**
- Create: `apps/pwa/src/services/backupService.ts`
- Create: `apps/pwa/src/services/__tests__/backupService.test.ts`
- Modify: `apps/pwa/src/services/nostrService.ts` (add `restoreIdentityFromSecretKey`)
- Modify: `apps/pwa/src/__tests__/nostrService.test.ts`

The file format + passphrase crypto + restore fan-out. **Read `nostrService.ts` first.**

- [ ] **Step 1: Add `restoreIdentityFromSecretKey` to `nostrService.ts` (failing test first)**

Add to `apps/pwa/src/__tests__/nostrService.test.ts` a new case (add `restoreIdentityFromSecretKey` to the `'../services/nostrService'` import and keep `loadSecretKey`/`clearSecretKey` from identityStore already imported there):

```ts
describe('restoreIdentityFromSecretKey', () => {
  beforeEach(async () => { await clearSecretKey(); __resetIdentityCacheForTests() })

  it('persists the given key and updates the cache (survives reload)', async () => {
    const seed = generateSecretKey() // from nostr-tools — already imported in this file
    const kp = await restoreIdentityFromSecretKey(seed)
    expect(kp.publicKey).toMatch(/^[0-9a-f]{64}$/)
    expect(getCachedKeypair().publicKey).toBe(kp.publicKey)
    __resetIdentityCacheForTests()
    expect((await loadIdentity()).publicKey).toBe(kp.publicKey)
  })
})
```

Run it to confirm failure:
```bash
cd apps/pwa && npx vitest run src/__tests__/nostrService.test.ts 2>&1 | tail -12
```
Expected: FAIL — `restoreIdentityFromSecretKey` not exported.

Implement in `nostrService.ts` (next to `generateNewIdentity`):

```ts
/** Restore an identity from a raw secret key (backup restore): persist + cache. */
export async function restoreIdentityFromSecretKey(sk: Uint8Array): Promise<NostrKeypair> {
  await saveSecretKey(sk)
  _keypair = { publicKey: getPublicKey(sk), secretKey: sk }
  _initPromise = null
  return _keypair
}
```

Run again — expect PASS.

- [ ] **Step 2: Write the failing backupService tests**

Create `apps/pwa/src/services/__tests__/backupService.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { exportBackup, decryptBackup, applyRestore } from '../backupService'
import { saveSecretKey, loadVault, upsertCircleKey, clearSecretKey, loadVaultMeta, formatVaultId, fingerprintPayload } from '../identityStore'
import { generateSecretKey } from 'nostr-tools'

function key(n: number): Uint8Array { const k = new Uint8Array(32); for (let i = 0; i < 32; i++) k[i] = (i * 3 + n) & 0xff; return k }
const PASS = 'correct horse battery staple'

async function seedVault(): Promise<void> {
  await clearSecretKey()
  await saveSecretKey(generateSecretKey())
  await upsertCircleKey('circle-1', key(1))
  await upsertCircleKey('circle-2', key(2))
}

describe('backupService', () => {
  beforeEach(seedVault)

  it('export then decrypt restores the exact identity + circles', async () => {
    const before = await loadVault()
    const blob = await exportBackup(PASS)
    const text = await blob.text()
    const { payload, vaultId } = await decryptBackup(text, PASS)
    expect(Array.from(payload.identitySk)).toEqual(Array.from(before!.identitySk))
    expect(payload.circles.map(c => c.id).sort()).toEqual(['circle-1', 'circle-2'])
    expect(vaultId).toBe(formatVaultId(await fingerprintPayload(before!)))
  })

  it('wrong passphrase throws a generic error', async () => {
    const text = await (await exportBackup(PASS)).text()
    await expect(decryptBackup(text, 'wrong passphrase here')).rejects.toThrow(/passphrase or corrupted/i)
  })

  it('tampered ciphertext throws', async () => {
    const file = JSON.parse(await (await exportBackup(PASS)).text())
    file.ciphertext = file.ciphertext.slice(0, -4) + (file.ciphertext.endsWith('A') ? 'B' : 'A') + file.ciphertext.slice(-3)
    await expect(decryptBackup(JSON.stringify(file), PASS)).rejects.toThrow()
  })

  it('rejects an unknown format/version', async () => {
    await expect(decryptBackup(JSON.stringify({ format: 'nope', version: 1 }), PASS)).rejects.toThrow(/unrecognized|unsupported|format/i)
  })

  it('exported envelope contains no plaintext identity bytes', async () => {
    const before = await loadVault()
    const text = await (await exportBackup(PASS)).text()
    const skB64 = btoa(String.fromCharCode(...before!.identitySk))
    expect(text).not.toContain(skB64)
  })

  it('exportBackup records lastExportedFingerprint in meta', async () => {
    await exportBackup(PASS)
    expect((await loadVaultMeta())?.lastExportedFingerprint).toBeTruthy()
  })

  it('applyRestore fans the payload into a wiped device', async () => {
    const before = await loadVault()
    const text = await (await exportBackup(PASS)).text()
    await clearSecretKey() // simulate a fresh device (identity gone)
    const { payload } = await decryptBackup(text, PASS)
    const result = await applyRestore(payload)
    expect(result.identityRestored).toBe(true)
    expect(result.circlesRestored).toBe(2)
    const after = await loadVault()
    expect(Array.from(after!.identitySk)).toEqual(Array.from(before!.identitySk))
    expect(after!.circles.map(c => c.id).sort()).toEqual(['circle-1', 'circle-2'])
  })
})
```

Run to confirm failure:
```bash
cd apps/pwa && npx vitest run src/services/__tests__/backupService.test.ts 2>&1 | tail -20
```
Expected: FAIL — `backupService` not found.

- [ ] **Step 3: Implement `backupService.ts`**

Create `apps/pwa/src/services/backupService.ts`:

```ts
// Self-custodial, passphrase-encrypted backup of the whole device vault (identity
// + circle keys + circle ids). The server never sees the file, the plaintext, or
// the passphrase. AES-GCM under a PBKDF2-derived key; a versioned file envelope.
// (H-3 Layer 2.)
import {
  loadVault, encodeVaultPayload, decodeVaultPayload, type VaultPayload,
  fingerprintPayload, formatVaultId, vaultFingerprint, saveVaultMeta,
} from './identityStore'
import { saveCircleKeyWithBackup } from './e2eeService'
import { restoreIdentityFromSecretKey } from './nostrService'
import { addCircleId } from './circleIdStore'

const FORMAT = 'sentinelmesh-vault-backup'
const FORMAT_VERSION = 1
const PBKDF2_ITERATIONS = 600_000

interface BackupFile {
  format: string
  version: number
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  iv: string
  ciphertext: string
}

export interface RestoreResult {
  identityRestored: boolean
  circlesRestored: number
  circlesFailed: string[]
}

function b64e(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)) }
function b64d(s: string): Uint8Array { return Uint8Array.from(atob(s), c => c.charCodeAt(0)) }

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

/** Encrypt the current vault under `passphrase` into a downloadable backup Blob.
 *  Also records the export fingerprint in vault meta and returns the Vault ID. */
export async function exportBackup(passphrase: string): Promise<Blob> {
  const payload = await loadVault()
  if (!payload) throw new Error('No identity to back up')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aesKey = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS)
  const plaintext = new TextEncoder().encode(encodeVaultPayload(payload))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext as unknown as BufferSource))
  const file: BackupFile = {
    format: FORMAT, version: FORMAT_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: b64e(salt) },
    iv: b64e(iv), ciphertext: b64e(ciphertext),
  }
  await saveVaultMeta({ lastExportedFingerprint: await vaultFingerprint() })
  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
}

/** The Vault ID of the currently-stored vault (for the export screen). */
export async function currentVaultId(): Promise<string> {
  return formatVaultId(await vaultFingerprint())
}

/** Parse + decrypt a backup file WITHOUT writing anything. Returns the payload
 *  and its Vault ID so the UI can show it before a destructive restore. */
export async function decryptBackup(fileText: string, passphrase: string): Promise<{ payload: VaultPayload; vaultId: string }> {
  let file: BackupFile
  try { file = JSON.parse(fileText) as BackupFile } catch { throw new Error('Not a valid backup file') }
  if (file?.format !== FORMAT || file?.version !== FORMAT_VERSION) throw new Error('Unrecognized or unsupported backup file format')
  try {
    const aesKey = await deriveKey(passphrase, b64d(file.kdf.salt), file.kdf.iterations)
    const plain = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64d(file.iv) as unknown as BufferSource }, aesKey, b64d(file.ciphertext) as unknown as BufferSource,
    ))
    const payload = decodeVaultPayload(new TextDecoder().decode(plain))
    return { payload, vaultId: formatVaultId(await fingerprintPayload(payload)) }
  } catch {
    throw new Error('Incorrect passphrase or corrupted backup file')
  }
}

/** Fan a decrypted payload into the device: identity first (atomic), then each
 *  circle best-effort. Replaces the current device identity. */
export async function applyRestore(payload: VaultPayload): Promise<RestoreResult> {
  await restoreIdentityFromSecretKey(payload.identitySk) // throws → abort before touching circles
  const circlesFailed: string[] = []
  let circlesRestored = 0
  for (const c of payload.circles) {
    try {
      await saveCircleKeyWithBackup(c.id, new Uint8Array(c.key))
      addCircleId(c.id)
      circlesRestored++
    } catch {
      circlesFailed.push(c.id)
    }
  }
  return { identityRestored: true, circlesRestored, circlesFailed }
}
```

- [ ] **Step 4: Run the tests + typecheck**

```bash
cd apps/pwa && npx vitest run src/services/__tests__/backupService.test.ts src/__tests__/nostrService.test.ts 2>&1 | tail -20
npx tsc --noEmit 2>&1 | grep -E "backupService|nostrService"; echo "ts-done"
```
Expected: PASS; no type errors. (The PBKDF2 round-trip at 600k iterations is fast enough for vitest; if a single test is slow, that is expected — do not lower the iteration count.)

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/services/backupService.ts apps/pwa/src/services/__tests__/backupService.test.ts apps/pwa/src/services/nostrService.ts apps/pwa/src/__tests__/nostrService.test.ts
git commit -m "H-3 L2: backupService export/decrypt/restore + nostrService.restoreIdentityFromSecretKey"
```

---

### Task 5: `SettingsPage` — Backup & Recovery UI (Vault ID + staleness)

**Files:**
- Modify: `apps/pwa/src/pages/SettingsPage.tsx`

Replace the Layer 1 "no recovery yet" warning with a Backup & Recovery subsection: Export (with passphrase + Vault ID), Import (with passphrase + Vault ID confirm + replace warning), and a staleness badge. **Read `SettingsPage.tsx` first** (Layer 1 left an async `loadIdentity()` effect, `keypair` state, and the warning block).

- [ ] **Step 1: Add state, imports, and the staleness check**

Add imports:

```tsx
import { exportBackup, decryptBackup, applyRestore, currentVaultId, type RestoreResult } from '../services/backupService'
import { vaultFingerprint, loadVaultMeta, formatVaultId } from '../services/identityStore'
import type { VaultPayload } from '../services/identityStore'
```

Inside the component, add state:

```tsx
  const [staleBadge, setStaleBadge] = useState<'none' | 'no-backup' | 'stale'>('none')
  const [exportPass, setExportPass] = useState('')
  const [exportPass2, setExportPass2] = useState('')
  const [shownVaultId, setShownVaultId] = useState<string | null>(null)
  const [backupMsg, setBackupMsg] = useState<{ text: string; ok: boolean } | null>(null)
  // Pending import awaiting Vault-ID confirmation:
  const [pendingPayload, setPendingPayload] = useState<{ payload: VaultPayload; vaultId: string } | null>(null)
```

Add a fingerprint refresh helper + effect:

```tsx
  const refreshStaleness = useCallback(async () => {
    const meta = await loadVaultMeta()
    if (!meta?.lastExportedFingerprint) { setStaleBadge('no-backup'); return }
    const current = await vaultFingerprint()
    setStaleBadge(current === meta.lastExportedFingerprint ? 'none' : 'stale')
  }, [])
  useEffect(() => { if (keypair) void refreshStaleness() }, [keypair, refreshStaleness])
```

- [ ] **Step 2: Export + import handlers**

```tsx
  const handleExport = useCallback(async () => {
    if (exportPass.length < 12) { setBackupMsg({ text: 'Passphrase must be at least 12 characters.', ok: false }); return }
    if (exportPass !== exportPass2) { setBackupMsg({ text: 'Passphrases do not match.', ok: false }); return }
    try {
      const blob = await exportBackup(exportPass)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'sentinelmesh-backup.json'; a.click()
      URL.revokeObjectURL(url)
      setShownVaultId(await currentVaultId())
      setExportPass(''); setExportPass2('')
      setBackupMsg({ text: 'Backup downloaded. Note your Vault ID to verify it later.', ok: true })
      void refreshStaleness()
    } catch {
      setBackupMsg({ text: 'Export failed on this device.', ok: false })
    }
  }, [exportPass, exportPass2, refreshStaleness])

  const handleFilePicked = useCallback(async (file: File, passphrase: string) => {
    try {
      const text = await file.text()
      const decoded = await decryptBackup(text, passphrase)
      setPendingPayload(decoded) // show Vault ID + confirm before writing
      setBackupMsg(null)
    } catch (e) {
      setBackupMsg({ text: (e as Error).message, ok: false })
    }
  }, [])

  const handleConfirmRestore = useCallback(async () => {
    if (!pendingPayload) return
    if (!window.confirm('Restore this backup? It will REPLACE the identity currently on this device.')) return
    try {
      const result: RestoreResult = await applyRestore(pendingPayload.payload)
      setPendingPayload(null)
      setKeypair(await loadIdentity()) // refresh shown npub/nsec
      const failed = result.circlesFailed.length
      setBackupMsg({
        text: `Restored your identity and ${result.circlesRestored} circle(s)` + (failed ? `; ${failed} could not be restored.` : '.'),
        ok: failed === 0,
      })
      void refreshStaleness()
    } catch {
      setBackupMsg({ text: 'Restore failed — your current identity is unchanged.', ok: false })
    }
  }, [pendingPayload, refreshStaleness])
```

- [ ] **Step 3: Replace the Layer 1 no-recovery warning with the Backup & Recovery UI**

Find the Layer 1 amber warning block (the `⚠ This key is stored only on this device. There is no recovery yet …` div) and replace it with a Backup & Recovery block. Use the existing monospace styling idiom from the file. The block must contain:

```tsx
        {/* ── Backup & Recovery ─────────────────────────────── */}
        <div style={{ borderTop: '1px solid #1a2035', margin: '14px 0', paddingTop: 14 }}>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', letterSpacing: '0.06em', marginBottom: 8 }}>
            BACKUP &amp; RECOVERY
            {staleBadge === 'stale' && <span style={{ color: '#FF8C00', marginLeft: 8 }}>⚠ Backup out of date — re-export</span>}
            {staleBadge === 'no-backup' && <span style={{ color: '#FF8C00', marginLeft: 8 }}>⚠ No backup yet</span>}
          </div>

          {/* Export */}
          <input type="password" value={exportPass} onChange={e => setExportPass(e.target.value)}
            placeholder="Backup passphrase (min 12 chars)" disabled={!keypair}
            style={{ width: '100%', boxSizing: 'border-box', background: '#0d1118', border: '1px solid #1a2035', borderRadius: 4, color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 11, padding: '7px 10px', marginBottom: 6 }} />
          <input type="password" value={exportPass2} onChange={e => setExportPass2(e.target.value)}
            placeholder="Confirm passphrase" disabled={!keypair}
            style={{ width: '100%', boxSizing: 'border-box', background: '#0d1118', border: '1px solid #1a2035', borderRadius: 4, color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 11, padding: '7px 10px', marginBottom: 6 }} />
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#FF8C00', marginBottom: 8 }}>
            There is no way to recover this passphrase. Store it safely — without it the backup cannot be opened.
          </div>
          <button onClick={handleExport} disabled={!keypair}
            style={{ background: 'none', border: '1px solid #1a2035', borderRadius: 4, color: keypair ? '#94a3b8' : '#4a5568', fontFamily: "'Courier New', monospace", fontSize: 10, padding: '6px 14px', cursor: keypair ? 'pointer' : 'not-allowed' }}>
            Export encrypted backup
          </button>
          {shownVaultId && (
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#00E5FF', marginTop: 8 }}>
              Vault ID: <strong>{shownVaultId}</strong> — note this to verify your backup later.
            </div>
          )}

          {/* Import */}
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', letterSpacing: '0.06em', margin: '14px 0 6px' }}>
            RESTORE FROM BACKUP
          </div>
          <input type="file" accept="application/json,.json"
            onChange={e => {
              const f = e.target.files?.[0]; if (!f) return
              const pass = window.prompt('Enter the passphrase for this backup file:') ?? ''
              void handleFilePicked(f, pass)
              e.target.value = ''
            }}
            style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#94a3b8' }} />

          {pendingPayload && (
            <div style={{ background: '#0d1118', border: '1px solid #2d1b00', borderRadius: 6, padding: '8px 10px', marginTop: 8 }}>
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#00E5FF', marginBottom: 6 }}>
                Backup Vault ID: <strong>{pendingPayload.vaultId}</strong>
              </div>
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#FF8C00', marginBottom: 8 }}>
                Confirm this matches the Vault ID you expect. Restoring REPLACES the identity on this device.
              </div>
              <button onClick={handleConfirmRestore}
                style={{ background: 'none', border: '1px solid #FF8C00', borderRadius: 4, color: '#FF8C00', fontFamily: "'Courier New', monospace", fontSize: 10, padding: '6px 14px', cursor: 'pointer', marginRight: 8 }}>
                Confirm restore
              </button>
              <button onClick={() => setPendingPayload(null)}
                style={{ background: 'none', border: '1px solid #1a2035', borderRadius: 4, color: '#4a5568', fontFamily: "'Courier New', monospace", fontSize: 10, padding: '6px 14px', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          )}

          {backupMsg && (
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, marginTop: 8, color: backupMsg.ok ? '#4CAF50' : '#FF2D2D' }}>
              {backupMsg.text}
            </div>
          )}
        </div>
```

Ensure `useEffect` is in the React import (Layer 1 already added it). Ensure `loadIdentity` is imported (Layer 1 imports it).

- [ ] **Step 4: Typecheck + run any page tests**

```bash
cd apps/pwa && npx tsc --noEmit; echo "tsc:$?"
npx vitest run src/pages 2>&1 | tail -10
```
Expected: `tsc:0`. (No `SettingsPage` test exists today; if one is added later it should mock `backupService`. A `tsc:0` plus a manual note is sufficient here.)

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/pages/SettingsPage.tsx
git commit -m "H-3 L2: SettingsPage backup/restore UI with Vault ID and staleness badge"
```

---

### Task 6: Final verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + suite**

```bash
cd apps/pwa && npx tsc --noEmit; echo "tsc:$?" && npx vitest run 2>&1 | tail -10
```
Expected: `tsc:0`; all PWA tests pass. Fix any fallout (e.g., a test that imported the now-removed exact `< 60` behavior, or a stale `saveCircleKey` mock) and re-run until green.

- [ ] **Step 2: Confirm the create flow no longer uses the non-capturing save**

```bash
cd apps/pwa && grep -rn "saveCircleKey\b" src --include=*.tsx --include=*.ts | grep -v "saveCircleKeyWithBackup" | grep -v "__tests__" | grep -v ".test."; echo "grep-done"
```
Expected: only the `e2eeService.ts` definition of `saveCircleKey` (kept for `CryptoKey`-only callers) — no live `saveCircleKey(` call site remains in components/services. If a live call site remains, route it through `saveCircleKeyWithBackup`.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/h3-identity-recovery
```
Then create the PR with a body file (avoid inline `--body` with apostrophes), base `main`:
```bash
gh pr create --base main --head feat/h3-identity-recovery --title "H-3 Layer 2: identity recovery (self-custodial encrypted backup)" --body-file <path-to-body>
```
Body should summarize: self-custodial passphrase-encrypted backup file (operator-blind, PBKDF2 + AES-GCM, versioned envelope); v2 vault carrying identity + circle keys + ids with v1→v2 migration; raw-key capture at create/rotate keeping live keys non-extractable; export/decrypt/applyRestore with a human-verifiable Vault ID; staleness badge; membership auto-restores from the deterministic circle token so restoring the identity re-establishes circles server-side. Note the known limitation (a key rotated after the last backup needs re-invite) and that this is a pure PWA change (no server change, no migration). If `feat/h3-identity-persistence` (PR #57, Layer 1) is not yet merged into `main`, note that this branch builds on it and should merge after it (or rebase onto `main` once #57 lands).

---

## Self-Review

- **Spec coverage:** v2 vault payload `{identitySk, circles}` + v1→v2 migration + Layer-1 API reimplemented on the vault (Task 1, spec Part A); separate `vault-meta` record, `upsert/removeVaultCircle`, `fingerprintPayload`/`vaultFingerprint`/`formatVaultId` (Task 2, spec Parts A + D); raw-key capture via `saveCircleKeyWithBackup` at the real save sites (create + rotate) and vault-aware `clearCircleKey` (Task 3, spec Part B); `exportBackup`/`decryptBackup`/`applyRestore` with PBKDF2+AES-GCM versioned envelope and the split for showing the Vault ID before the destructive write, plus `restoreIdentityFromSecretKey` (Task 4, spec Part C); SettingsPage export/import/Vault-ID/staleness/replace-confirm (Task 5, spec Parts D + E); error handling — unknown format/version rejected pre-decrypt, generic wrong-passphrase/tamper error, identity-first-then-best-effort restore, disabled-when-no-identity (Tasks 4–5, spec Part F); tests for migration, round-trip, wrong passphrase, tamper, no-plaintext, fingerprint/Vault-ID stability, capture non-extractable+vault, restore fan-out (Tasks 1–4, spec Part G). The spec's hypothetical **join-time capture** has no live save site in the current code (join only `addCircleId`s), so capture is wired only at create + rotate; `saveCircleKeyWithBackup` is the helper a future join-save path will use — documented in Task 3.
- **Placeholder scan:** none — every code step has full TS + exact commands and expected output.
- **Type consistency:** `VaultPayload{identitySk:Uint8Array; circles:VaultCircle[]}`, `VaultCircle{id:string; key:Uint8Array}`, `VaultMeta{lastExportedFingerprint:string}` (Task 1–2) are used identically in `e2eeService` (Task 3), `backupService` (Task 4), and `SettingsPage` (Task 5). `saveCircleKeyWithBackup(circleId:string, rawKey:Uint8Array)→Promise<void>`, `upsertCircleKey(id, rawKey)`, `removeVaultCircle(id)`, `fingerprintPayload(payload)→Promise<string>`, `vaultFingerprint()→Promise<string>`, `formatVaultId(fp)→string`, `exportBackup(pass)→Promise<Blob>`, `decryptBackup(text, pass)→Promise<{payload, vaultId}>`, `applyRestore(payload)→Promise<RestoreResult>`, `restoreIdentityFromSecretKey(sk)→Promise<NostrKeypair>` are referenced consistently across tasks. The Layer 1 `loadSecretKey`/`saveSecretKey`/`loadOrCreateSecretKey` keep their signatures while now reading/writing the vault.
- **Known follow-ups (out of scope):** re-wrap-from-member recovery for keys rotated after a backup; server-assisted/cloud backup; passphrase change of an existing file; wiring a join-time key-save path (and capturing it via `saveCircleKeyWithBackup`).
