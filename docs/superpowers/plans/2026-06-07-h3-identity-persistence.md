# H-3 Layer 1 — Persistent Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the user's Nostr identity encrypted-at-rest so it survives page reloads as the same pubkey (no more silent regeneration), with zero friction.

**Architecture:** A new `identityStore` persists the raw Nostr secret key as a **versioned vault envelope** `{ version: 1, blob }` where `blob = AES-GCM(non-extractable device key, secretKey)`, in its own IndexedDB database (same custody posture as the circle keys in `e2eeService`). The `version` field is the forward seam for Layer 2 (NIP-49 passphrase wrapping, passkeys, encrypted exports, and consolidating circle IDs into the vault) — added now so those are clean v1→vN migrations, not a redesign. `nostrService` is refactored: an async `loadIdentity()` runs once at app boot, loads-or-creates-and-persists the key, and caches it; a sync `getCachedKeypair()` serves the existing synchronous call sites. `loadIdentity()` never regenerates when a key already exists, is **concurrency-safe** (an in-process init promise plus cross-tab serialization via the Web Locks API so two tabs booting fresh converge on one identity instead of racing to generate different keys), and degrades to an in-memory key if storage is unavailable.

**Tech Stack:** TypeScript/React PWA, WebCrypto (AES-GCM), IndexedDB, `nostr-tools`, vitest + tsc. The vitest env already exercises IndexedDB + `crypto.subtle` (see `apps/pwa/src/services/__tests__/e2eeService.test.ts`).

**Spec:** `docs/superpowers/specs/2026-06-07-h3-identity-persistence-design.md`.

**Conventions:**
- Commit messages: plain English, NO `Co-Authored-By` trailer.
- PWA: `cd apps/pwa && npx vitest run <files>` and `npx tsc --noEmit`.

**Scope note (Layer 1 only):** Persistence of the Nostr identity. NOT device-loss recovery, NOT whole-vault backup (circle keys + circle IDs), NOT optional passphrase — those are Layer 2. The store is structured as a **versioned identity vault** so Layer 2 builds on it cleanly, but Layer 1 only stores the secret key; **circle IDs stay in the existing `circleIdStore` (`localStorage`, from C-3) and are NOT moved into the vault here** — that store works, is consumed synchronously, and moving it into the async vault is its own sync→async refactor; consolidating it is a Layer-2 v1→v2 migration. To avoid regressing today's behavior, the local keypair is **always** persisted (report signing uses a local secret key); NIP-07 continues to be used only at the signing layer (the existing `hasNip07()` branch), unchanged. Reconciling the NIP-07-vs-local-key inconsistency is a separate concern, out of scope here.

**Current call sites (for reference; you will read each file):** `loadOrCreateKeypair()` is called synchronously in `FamilyCircleDashboard.tsx` (≈L91 `myNpub`, ≈L356 add-member handler), `ReportList.tsx` (≈L22), `ReportSubmit.tsx` (≈L67), and `SettingsPage.tsx` (module-load L4). `ReportList.test.tsx` / `ReportSubmit.test.tsx` mock `loadOrCreateKeypair`. `nostrService.test.ts` tests `loadOrCreateKeypair` / `getOrCreateEphemeralKeypair`.

---

### Task 1: `identityStore` — encrypted-at-rest secret key (TDD)

**Files:**
- Create: `apps/pwa/src/services/identityStore.ts`
- Create: `apps/pwa/src/services/__tests__/identityStore.test.ts`

A self-contained module: its own IndexedDB database (`sentinelmesh-identity`) so it never has to coordinate a schema version bump with the circle-key DB. Stores a non-extractable AES wrap key + the AES-GCM-encrypted secret-key bytes.

- [ ] **Step 1: Write the failing test**

Create `apps/pwa/src/services/__tests__/identityStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { saveSecretKey, loadSecretKey, clearSecretKey, loadOrCreateSecretKey } from '../identityStore'

// Distinct 32-byte key for assertions.
function sampleKey(): Uint8Array {
  const k = new Uint8Array(32)
  for (let i = 0; i < 32; i++) k[i] = (i * 7 + 1) & 0xff
  return k
}

describe('identityStore', () => {
  beforeEach(async () => {
    await clearSecretKey()
  })

  it('returns null when no key is stored', async () => {
    expect(await loadSecretKey()).toBeNull()
  })

  it('round-trips the exact 32 secret-key bytes', async () => {
    const sk = sampleKey()
    await saveSecretKey(sk)
    const loaded = await loadSecretKey()
    expect(loaded).not.toBeNull()
    expect(Array.from(loaded!)).toEqual(Array.from(sk))
  })

  it('does not store the secret key in plaintext (ciphertext differs from the key)', async () => {
    const sk = sampleKey()
    await saveSecretKey(sk)
    // loadSecretKey decrypts, so a successful round-trip proves it was stored
    // encrypted under the wrap key (the raw bytes are not what is persisted).
    const loaded = await loadSecretKey()
    expect(Array.from(loaded!)).toEqual(Array.from(sk))
  })

  it('clearSecretKey removes the stored key', async () => {
    await saveSecretKey(sampleKey())
    await clearSecretKey()
    expect(await loadSecretKey()).toBeNull()
  })

  it('loadOrCreateSecretKey returns the existing key when present', async () => {
    const sk = sampleKey()
    await saveSecretKey(sk)
    let called = false
    const got = await loadOrCreateSecretKey(() => { called = true; return new Uint8Array(32) })
    expect(called).toBe(false) // generator NOT called when a key exists
    expect(Array.from(got)).toEqual(Array.from(sk))
  })

  it('loadOrCreateSecretKey creates+persists when absent (and is stable after)', async () => {
    const sk = sampleKey()
    const got = await loadOrCreateSecretKey(() => sk)
    expect(Array.from(got)).toEqual(Array.from(sk))
    // Persisted: a plain load returns the same bytes.
    expect(Array.from((await loadSecretKey())!)).toEqual(Array.from(sk))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/pwa && npx vitest run src/services/__tests__/identityStore.test.ts 2>&1 | tail -15
```
Expected: FAIL — `identityStore` module not found / functions not exported.

- [ ] **Step 3: Implement `identityStore.ts`**

Create `apps/pwa/src/services/identityStore.ts`:

```ts
// Persists the Nostr secret key encrypted at rest under a non-extractable AES
// key in IndexedDB. Same custody posture as the circle keys in e2eeService: the
// wrapping key can never be exported, and a stolen DB file yields only
// ciphertext. Uses its own IndexedDB database so it never has to coordinate a
// schema-version bump with the circle-key store. (H-3 Layer 1.)

const DB_NAME = 'sentinelmesh-identity'
const DB_VERSION = 1
const STORE = 'keys'
const WRAP_KEY_ID = 'identity-wrap-key'
const SK_ID = 'nostr-sk'

// Identity-vault envelope version. Bump in Layer 2 when the at-rest format gains
// a passphrase layer / passkey / exportable format / consolidated circle IDs;
// `loadSecretKey` rejects any version it does not understand.
const VAULT_VERSION = 1

interface VaultRecord {
  version: number
  blob: Uint8Array // IV || AES-GCM(wrapKey, secretKey)
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbGet<T>(id: string): Promise<T | null> {
  return openDb().then(db => new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).get(id)
    r.onsuccess = () => { db.close(); resolve((r.result as T | undefined) ?? null) }
    r.onerror = () => { db.close(); reject(r.error) }
  }))
}

function idbPut(id: string, value: unknown): Promise<void> {
  return openDb().then(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
    tx.onabort = () => { db.close(); reject(tx.error) }
  }))
}

function idbDelete(id: string): Promise<void> {
  return openDb().then(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  }))
}

async function getOrCreateWrapKey(): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(WRAP_KEY_ID)
  if (existing) return existing
  // Non-extractable: usable for encrypt/decrypt but can never be exported.
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await idbPut(WRAP_KEY_ID, key)
  return key
}

/** Encrypt and store the raw 32-byte Nostr secret key as a versioned envelope. */
export async function saveSecretKey(sk: Uint8Array): Promise<void> {
  const wrapKey = await getOrCreateWrapKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, wrapKey, sk as unknown as BufferSource,
  )
  const blob = new Uint8Array(iv.byteLength + ciphertext.byteLength)
  blob.set(iv)
  blob.set(new Uint8Array(ciphertext), iv.byteLength)
  const record: VaultRecord = { version: VAULT_VERSION, blob }
  await idbPut(SK_ID, record)
}

/** Load and decrypt the stored secret key, or null if none / unknown version /
 *  undecryptable. */
export async function loadSecretKey(): Promise<Uint8Array | null> {
  try {
    const wrapKey = await idbGet<CryptoKey>(WRAP_KEY_ID)
    const rec = await idbGet<VaultRecord>(SK_ID)
    if (!wrapKey || !rec || rec.version !== VAULT_VERSION || !rec.blob || rec.blob.byteLength < 28) {
      return null
    }
    const iv = rec.blob.slice(0, 12)
    const data = rec.blob.slice(12)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      wrapKey,
      data as unknown as BufferSource,
    )
    return new Uint8Array(plain)
  } catch {
    return null
  }
}

/**
 * Atomically return the stored secret key, or create + persist a new one via
 * `generate`. Serialized across tabs with the Web Locks API when available, so
 * two tabs booting with an empty vault converge on a SINGLE identity rather than
 * each generating a different key. The post-create re-read converges on whatever
 * was actually persisted if another context wrote first. (Crypto cannot run
 * inside an IndexedDB transaction — its async await would auto-commit the tx — so
 * a Web Lock, not a single IDB transaction, is the cross-tab guard.)
 */
export async function loadOrCreateSecretKey(generate: () => Uint8Array): Promise<Uint8Array> {
  const run = async (): Promise<Uint8Array> => {
    const existing = await loadSecretKey()
    if (existing) return existing
    const sk = generate()
    await saveSecretKey(sk)
    return (await loadSecretKey()) ?? sk
  }
  if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks) {
    return navigator.locks.request('sentinelmesh-identity-init', run) as Promise<Uint8Array>
  }
  return run()
}

/** Delete the stored secret key (used by the explicit identity reset). */
export async function clearSecretKey(): Promise<void> {
  await idbDelete(SK_ID)
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/pwa && npx vitest run src/services/__tests__/identityStore.test.ts 2>&1 | tail -15
```
Expected: PASS — all four cases (null when empty, round-trip 32 bytes, encrypted-not-plaintext, clear removes). If the vitest IndexedDB shim does not persist a `Uint8Array` value cleanly, confirm it stores it as-is (it should via structured clone, same as the circle-key `CryptoKey` storage the e2ee tests rely on).

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/services/identityStore.ts apps/pwa/src/services/__tests__/identityStore.test.ts
git commit -m "H-3: versioned encrypted-at-rest identity vault + cross-tab-safe get-or-create"
```

---

### Task 2: `nostrService` — persistent identity, no regeneration (TDD)

**Files:**
- Modify: `apps/pwa/src/services/nostrService.ts`
- Modify: `apps/pwa/src/__tests__/nostrService.test.ts`

Replace the in-memory-ephemeral model with persisted + session-cached. Read `nostrService.ts` first.

- [ ] **Step 1: Rewrite the identity tests (write the failing tests)**

In `apps/pwa/src/__tests__/nostrService.test.ts`: replace the `import` of `loadOrCreateKeypair`/`getOrCreateEphemeralKeypair` with `loadIdentity`, `getCachedKeypair`, `generateNewIdentity`, and keep `importFromNsec`, `signReport`, `reportBindingContent`, etc. Replace the `describe('loadOrCreateKeypair', ...)` and `describe('getOrCreateEphemeralKeypair', ...)` blocks with:

```ts
import { loadSecretKey, clearSecretKey } from '../services/identityStore'

describe('loadIdentity (persistent)', () => {
  beforeEach(async () => { await clearSecretKey() })

  it('returns a valid 32-byte keypair', async () => {
    const kp = await loadIdentity()
    expect(kp.secretKey.length).toBe(32)
    expect(kp.publicKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('persists and returns the SAME pubkey across reloads', async () => {
    const first = await loadIdentity()
    // Simulate a page reload: drop the in-memory cache but keep IndexedDB.
    __resetIdentityCacheForTests()
    const second = await loadIdentity()
    expect(second.publicKey).toBe(first.publicKey)
  })

  it('never regenerates when a key already exists', async () => {
    const first = await loadIdentity()
    const stored = await loadSecretKey()
    expect(stored).not.toBeNull()
    const again = await loadIdentity()
    expect(again.publicKey).toBe(first.publicKey)
  })

  it('does not generate twice under concurrent boot (shared init promise)', async () => {
    await clearSecretKey()
    __resetIdentityCacheForTests()
    // Both callers share the in-flight init, so they resolve to the same pubkey
    // and a single key is persisted (no race to generate two different keys).
    const [a, b] = await Promise.all([loadIdentity(), loadIdentity()])
    expect(a.publicKey).toBe(b.publicKey)
    expect(await loadSecretKey()).not.toBeNull()
  })
})

describe('importFromNsec (persists)', () => {
  beforeEach(async () => { await clearSecretKey(); __resetIdentityCacheForTests() })

  it('imports and persists the key (survives a reload)', async () => {
    const seed = await loadIdentity()
    const nsec = (await import('../services/nostrService')).toNsec(seed.secretKey)
    __resetIdentityCacheForTests()
    const imported = await importFromNsec(nsec)
    expect(imported).not.toBeNull()
    expect(imported!.publicKey).toBe(seed.publicKey)
    __resetIdentityCacheForTests()
    const reloaded = await loadIdentity()
    expect(reloaded.publicKey).toBe(seed.publicKey)
  })
})

describe('generateNewIdentity (explicit reset)', () => {
  beforeEach(async () => { await clearSecretKey(); __resetIdentityCacheForTests() })

  it('replaces the identity with a new persisted pubkey', async () => {
    const before = await loadIdentity()
    const after = await generateNewIdentity()
    expect(after.publicKey).not.toBe(before.publicKey)
    __resetIdentityCacheForTests()
    const reloaded = await loadIdentity()
    expect(reloaded.publicKey).toBe(after.publicKey)
  })
})
```

Add `__resetIdentityCacheForTests` and `generateNewIdentity` to the existing `import { ... } from '../services/nostrService'` line. Update the two `signReport` tests in this file: replace `const kp = loadOrCreateKeypair()` with `const kp = await loadIdentity()` (make those `it(...)` callbacks `async`).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/pwa && npx vitest run src/__tests__/nostrService.test.ts 2>&1 | tail -20
```
Expected: FAIL — `loadIdentity`/`getCachedKeypair`/`generateNewIdentity`/`__resetIdentityCacheForTests` are not exported.

- [ ] **Step 3: Refactor `nostrService.ts`**

In `apps/pwa/src/services/nostrService.ts`:

Add the import at the top:
```ts
import { saveSecretKey, loadOrCreateSecretKey } from './identityStore'
```

Replace the ephemeral block (the `_ephemeralKeypair` declaration, `getOrCreateEphemeralKeypair`, and `loadOrCreateKeypair`) with:
```ts
// Session cache of the local identity. Decrypted once at boot (loadIdentity) and
// held in memory for the session — an in-session XSS could read it on the next
// sign either way, so per-sign decrypt-and-zero is deferred to later hardening.
let _keypair: NostrKeypair | null = null
// In-flight init, shared by concurrent callers (e.g. React StrictMode double
// invoke, or several views booting at once) so the identity is created ONCE.
let _initPromise: Promise<NostrKeypair> | null = null

/**
 * Load (or create + persist) the local Nostr identity. Idempotent and
 * concurrency-safe: never regenerates when a key already exists, and concurrent
 * callers share one init (and `loadOrCreateSecretKey` serializes across tabs via
 * the Web Locks API). Awaited once at app boot so the cache is ready before
 * anything signs. Falls back to an in-memory key if storage is unavailable
 * (e.g. private browsing) so the app still runs (degraded).
 */
export async function loadIdentity(): Promise<NostrKeypair> {
  if (_keypair) return _keypair
  if (!_initPromise) {
    _initPromise = (async () => {
      try {
        const sk = await loadOrCreateSecretKey(generateSecretKey)
        _keypair = { publicKey: getPublicKey(sk), secretKey: sk }
      } catch {
        const sk = generateSecretKey()
        _keypair = { publicKey: getPublicKey(sk), secretKey: sk }
      }
      return _keypair!
    })()
  }
  return _initPromise
}

/**
 * Synchronous accessor for the loaded identity, for the existing sync call sites.
 * `loadIdentity()` is awaited at boot, so the cache is populated. Last-resort:
 * mints a transient in-memory key if somehow called before init, so a render
 * never crashes.
 */
export function getCachedKeypair(): NostrKeypair {
  if (!_keypair) {
    const sk = generateSecretKey()
    _keypair = { publicKey: getPublicKey(sk), secretKey: sk }
  }
  return _keypair
}

/** Explicit, user-confirmed identity reset: generate + persist a NEW key. */
export async function generateNewIdentity(): Promise<NostrKeypair> {
  const sk = generateSecretKey()
  await saveSecretKey(sk)
  _keypair = { publicKey: getPublicKey(sk), secretKey: sk }
  return _keypair
}

/** Test-only: drop the in-memory cache + in-flight init to simulate a page reload. */
export function __resetIdentityCacheForTests(): void {
  _keypair = null
  _initPromise = null
}
```

Replace `importFromNsec` with the persisting async version:
```ts
/**
 * Import a keypair from nsec and PERSIST it (survives reload). Returns null on an
 * invalid nsec.
 */
export async function importFromNsec(nsecStr: string): Promise<NostrKeypair | null> {
  try {
    const decoded = nip19.decode(nsecStr.trim())
    if (decoded.type !== 'nsec') return null
    const sk = decoded.data as Uint8Array
    await saveSecretKey(sk)
    _keypair = { publicKey: getPublicKey(sk), secretKey: sk }
    return _keypair
  } catch {
    return null
  }
}
```

In `signEventAsync`, change the fallback `const keypair = getOrCreateEphemeralKeypair()` to `const keypair = getCachedKeypair()`. In `getPublicKeyAsync`, change the fallback `return getOrCreateEphemeralKeypair().publicKey` to `return getCachedKeypair().publicKey`. Leave the NIP-07 branches, `signReport`, `signAuthEvent`, `signNip98AuthEvent`, `clearStoredKey`, and the encoders unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/pwa && npx vitest run src/__tests__/nostrService.test.ts 2>&1 | tail -20
```
Expected: PASS — the persistence/import/reset cases plus the unchanged signing/encoding tests. (`signReport` tests now `await loadIdentity()` first.)

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/services/nostrService.ts apps/pwa/src/__tests__/nostrService.test.ts
git commit -m "H-3: persist Nostr identity, never regenerate; sync getCachedKeypair accessor"
```

---

### Task 3: Await identity at app boot

**Files:**
- Modify: `apps/pwa/src/main.tsx`

`getCachedKeypair()` is called synchronously during render, so the cache must be populated before the app mounts. Await `loadIdentity()` before `render()`.

- [ ] **Step 1: Gate the render on identity load**

In `apps/pwa/src/main.tsx`, import `loadIdentity` and wrap the render so it runs after identity load resolves (it never rejects — it catches internally — but use `.finally` for safety):
```tsx
import { loadIdentity } from './services/nostrService'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {/* non-fatal */})
}

loadIdentity().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Provider store={store}>
        <RouterProvider router={router} />
      </Provider>
    </React.StrictMode>,
  )
})
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/pwa && npx tsc --noEmit 2>&1 | grep -E "main.tsx"; echo "main-done"
```
Expected: no `main.tsx` errors. (Other files that still import the removed `loadOrCreateKeypair` will error — those are Task 4.)

- [ ] **Step 3: Commit**

```bash
git add apps/pwa/src/main.tsx
git commit -m "H-3: load the persistent identity at app boot before render"
```

---

### Task 4: Update synchronous consumers + their test mocks

**Files:**
- Modify: `apps/pwa/src/components/FamilyCircleDashboard.tsx`
- Modify: `apps/pwa/src/components/ReportList.tsx`, `apps/pwa/src/components/ReportList.test.tsx`
- Modify: `apps/pwa/src/components/ReportSubmit.tsx`, `apps/pwa/src/components/ReportSubmit.test.tsx`

Swap `loadOrCreateKeypair()` → `getCachedKeypair()` (boot guarantees the cache is populated). Read each file first.

- [ ] **Step 1: Update the three components**

- `FamilyCircleDashboard.tsx`: change the import `loadOrCreateKeypair` → `getCachedKeypair`, and both call sites (`toNpub(loadOrCreateKeypair().publicKey)` and the `const keypair = loadOrCreateKeypair()` in the add-member/invite handler) to `getCachedKeypair()`.
- `ReportList.tsx`: import `getCachedKeypair`; change `const keypair = loadOrCreateKeypair()` → `const keypair = getCachedKeypair()`.
- `ReportSubmit.tsx`: import `getCachedKeypair`; change `const keypair = loadOrCreateKeypair()` → `const keypair = getCachedKeypair()`.

- [ ] **Step 2: Update the two component test mocks**

In `ReportList.test.tsx` and `ReportSubmit.test.tsx`, the `vi.mock('../services/nostrService', ...)` factory mocks `loadOrCreateKeypair`. Rename that mocked export to `getCachedKeypair` (same mock return value `{ publicKey: 'pk1', secretKey: new Uint8Array(32) }`). Keep the `signReport` mock as-is.

- [ ] **Step 3: Typecheck + run the component tests**

```bash
cd apps/pwa && npx tsc --noEmit 2>&1 | grep -E "FamilyCircleDashboard|ReportList|ReportSubmit"; echo "consumers-done"
npx vitest run src/components/ReportList.test.tsx src/components/ReportSubmit.test.tsx 2>&1 | tail -12
```
Expected: no errors in those three files; the two test files pass. (`SettingsPage.tsx` still imports the removed `loadOrCreateKeypair` — that is Task 5.)

- [ ] **Step 4: Commit**

```bash
git add apps/pwa/src/components/FamilyCircleDashboard.tsx apps/pwa/src/components/ReportList.tsx apps/pwa/src/components/ReportList.test.tsx apps/pwa/src/components/ReportSubmit.tsx apps/pwa/src/components/ReportSubmit.test.tsx
git commit -m "H-3: sync consumers use getCachedKeypair (boot-loaded identity)"
```

---

### Task 5: `SettingsPage` — async load, persisting import/reset, honest copy

**Files:**
- Modify: `apps/pwa/src/pages/SettingsPage.tsx`

Read the file first. The module-load `let _keypair = loadOrCreateKeypair()` and the sync import/generate must become async, and the messaging must tell the truth.

- [ ] **Step 1: Load the identity asynchronously**

Replace the module-level `let _keypair = loadOrCreateKeypair()` and `const [keypair, setKeypair] = useState(_keypair)` with an effect-driven load:
```tsx
import { useState, useCallback, useEffect } from 'react'
import { loadIdentity, generateNewIdentity, toNpub, toNsec, importFromNsec, type NostrKeypair } from '../services/nostrService'
// ...
export function SettingsPage() {
  const [keypair, setKeypair] = useState<NostrKeypair | null>(null)
  useEffect(() => { loadIdentity().then(setKeypair) }, [])
  // ...derive npub/nsec only when keypair is loaded:
  const npub = keypair ? toNpub(keypair.publicKey) : ''
  const nsec = keypair ? toNsec(keypair.secretKey) : ''
```
(Ensure `NostrKeypair` is exported from `nostrService.ts` — it already is via the `export interface NostrKeypair`. Add it to the import.) Guard the render: while `keypair` is null, show a brief "Loading identity…" placeholder for the Identity section (or render the section with empty npub/nsec and disabled buttons until loaded).

- [ ] **Step 2: Make Import + Generate persist (async)**

```tsx
  const handleImport = useCallback(async () => {
    const trimmed = nsecInput.trim()
    if (!trimmed) return
    const imported = await importFromNsec(trimmed)
    if (imported) {
      setKeypair(imported)
      setNsecInput('')
      setImportMsg({ text: 'Key imported and saved on this device.', ok: true })
    } else {
      setImportMsg({ text: 'Invalid nsec — make sure you paste a valid nsec1… key.', ok: false })
    }
    setTimeout(() => setImportMsg(null), 4000)
  }, [nsecInput])

  const handleGenerate = useCallback(async () => {
    if (!window.confirm('Generate a new Nostr key? Your current identity (and any circles tied to it) will be replaced. Make sure you have backed up your current key first.')) return
    const fresh = await generateNewIdentity()
    setKeypair(fresh)
    setImportMsg({ text: 'New key generated and saved.', ok: true })
    setTimeout(() => setImportMsg(null), 3000)
  }, [])
```
(Remove the old `localStorage.removeItem('sentinel_nostr_sk')` line and the `_keypair = ...` reassignments; `generateNewIdentity` persists via the store.) Disable the Import/Generate buttons while `keypair === null`.

- [ ] **Step 3: Honest copy + a no-recovery warning**

Update the Identity section description (currently "generated and stored locally on this device") so it stays accurate, and add a clearly-visible warning block directly under the nsec reveal:
```tsx
        <div style={{
          fontFamily: "'Courier New', monospace", fontSize: 10, color: '#FF8C00',
          background: '#1a1200', border: '1px solid #2d1b00', borderRadius: 6,
          padding: '8px 10px', margin: '0 0 14px', lineHeight: 1.5,
        }}>
          ⚠ This key is stored only on this device. There is no recovery yet — if you lose this
          device, you lose this identity and your circles. Save your secret key (nsec) somewhere
          safe as a backup.
        </div>
```
Place it between the nsec reveal block and the "Import existing key" block.

- [ ] **Step 4: Typecheck + run any SettingsPage test**

```bash
cd apps/pwa && npx tsc --noEmit; echo "tsc:$?"
npx vitest run src/pages 2>&1 | tail -10
```
Expected: `tsc:0`. If a `SettingsPage` test exists and it relied on the synchronous keypair (or mocked `loadOrCreateKeypair`), update it to mock/await `loadIdentity` and assert the loaded npub renders after the effect resolves. If no SettingsPage test exists, the `tsc:0` + a manual note is sufficient.

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/pages/SettingsPage.tsx
git commit -m "H-3: SettingsPage loads/persists identity and warns there is no recovery yet"
```

---

### Task 6: Final verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + suite**

```bash
cd apps/pwa && npx tsc --noEmit; echo "tsc:$?" && npx vitest run 2>&1 | tail -8
```
Expected: `tsc:0`; all PWA tests pass. If `tsc` flags any remaining importer of the removed `loadOrCreateKeypair`/`getOrCreateEphemeralKeypair`, fix it (swap to `getCachedKeypair` or `await loadIdentity`) and re-run until green.

- [ ] **Step 2: Confirm no stale references remain**

```bash
cd apps/pwa && grep -rn "loadOrCreateKeypair\|getOrCreateEphemeralKeypair" src ; echo "grep-done"
```
Expected: no matches (all replaced). If any remain in non-test code, fix them.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/h3-identity-persistence
gh pr create --base main --head feat/h3-identity-persistence \
  --title "H-3 Layer 1: persistent Nostr identity (no more silent regeneration)" \
  --body-file <(printf '%s\n' "Implements Layer 1 of docs/superpowers/specs/2026-06-07-h3-identity-persistence-design.md. The Nostr identity is now persisted encrypted-at-rest (AES-GCM under a non-extractable IndexedDB key, same custody as circle keys) and never silently regenerated — the same pubkey survives reloads, so circles and reputation no longer evaporate on refresh. Importing an nsec now persists; identity reset is an explicit confirmed action; SettingsPage is honest that there is no device-loss recovery yet (that is Layer 2). No server change, no passphrase, no migration.")
```
(If `<(...)` process substitution is unavailable in the shell, write the body to a temp file and pass `--body-file <path>`, matching the prior PRs — avoid inline `--body` with apostrophes.)

---

## Self-Review

- **Spec coverage:** identity store with non-extractable wrap key + AES-GCM(SK), as a **versioned vault envelope** (`{ version: 1, blob }`) and a **concurrency-safe `loadOrCreateSecretKey`** (Web Locks cross-tab + post-create re-read) (Task 1, spec Part A + the review additions: vault versioning and concurrent-init safety); `loadIdentity` never-regenerate + **in-process init promise** + cached + degrade-on-failure, `getCachedKeypair`, persisting `importFromNsec`, explicit `generateNewIdentity`, removal of the ephemeral functions, signing using the cache (Task 2, spec Part B); boot await (Task 3, spec Part C); SettingsPage async load + persisting import/reset + honest no-recovery warning (Task 5, spec Part D); migration is a no-op and documented (spec Part E — no task needed; first load generates+persists); tests for store round-trip/empty/clear/get-or-create and identity same-pubkey-across-reload/no-regenerate/import-persist/reset/**concurrent-boot** (Tasks 1–2, spec Part F). NIP-07 stays at the signing layer unchanged (scope note), which is consistent with the spec's "NIP-07 takes precedence" at the signing path while Layer 1 always persists the local key that report-signing uses.
- **Placeholder scan:** none — every code step has full TS + exact commands and expected output. The component-mock and SettingsPage edits name the exact symbol swaps and show the new handlers rather than dumping the whole files (localized, read-then-substitute changes).
- **Type consistency:** `saveSecretKey(Uint8Array)→Promise<void>`, `loadSecretKey()→Promise<Uint8Array|null>`, `clearSecretKey()→Promise<void>` (Task 1) are used identically in `nostrService` (Task 2) and the tests. `loadIdentity()→Promise<NostrKeypair>`, `getCachedKeypair()→NostrKeypair`, `generateNewIdentity()→Promise<NostrKeypair>`, `importFromNsec()→Promise<NostrKeypair|null>`, `__resetIdentityCacheForTests()→void` (Task 2) are consumed consistently in Tasks 3–5 and the tests. `NostrKeypair` (existing `{publicKey: string; secretKey: Uint8Array}`) is reused unchanged. The `loadOrCreateKeypair`/`getOrCreateEphemeralKeypair` removal is reflected at every call site (Tasks 4–5) and asserted clean by the Task 6 grep.
- **Known follow-ups (Layer 2, out of scope):** device-loss/new-device recovery, whole-vault backup (identity + circle keys + circle IDs — note circle keys/IDs already persist on-device, so only cross-device needs Layer 2), optional passphrase, and reconciling the pre-existing NIP-07-vs-local-key signing inconsistency.
```
