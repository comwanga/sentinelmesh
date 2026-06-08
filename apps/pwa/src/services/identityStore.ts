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

// v1 stored only the raw secret key. v2 stores a structured vault payload so a
// backup can carry the identity AND the circle keys + ids. loadVault migrates a
// v1 record to v2 on first read.
const VAULT_VERSION = 2

export interface VaultCircle { id: string; key: Uint8Array }      // raw 32-byte AES key
export interface VaultPayload { identitySk: Uint8Array; circles: VaultCircle[] }

interface VaultRecord { version: number; blob: Uint8Array } // blob = IV || AES-GCM(wrapKey, serialized payload)

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
    tx.onabort = () => { db.close(); reject(tx.error) }
  }))
}

// Run fn under the 'sentinelmesh-identity-init' Web Lock when available.
// All public mutating entry points acquire this lock at their top level.
// NEVER call withInitLock inside a function that is itself called under the
// same lock — the Web Locks API is not reentrant and nesting would deadlock.
function withInitLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks) {
    return navigator.locks.request('sentinelmesh-identity-init', fn) as unknown as Promise<T>
  }
  return fn()
}

// Lock-free internal: read existing wrap key or generate + persist a new one.
// Called only from within an already-held init lock.
async function getOrCreateWrapKey(): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(WRAP_KEY_ID)
  if (existing) return existing
  // Non-extractable: usable for encrypt/decrypt but can never be exported.
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await idbPut(WRAP_KEY_ID, key)
  return key
}

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

/**
 * Atomically return the stored secret key, or create + persist a new one via
 * `generate`. Serialized across tabs with the Web Locks API when available, so
 * two tabs booting with an empty vault converge on a SINGLE identity rather than
 * each generating a different key. The post-create re-read converges on whatever
 * was actually persisted if another context wrote first. (Crypto cannot run
 * inside an IndexedDB transaction — its async await would auto-commit the tx — so
 * a Web Lock, not a single IDB transaction, is the cross-tab guard.)
 *
 * Lock design: withInitLock is acquired once at the top of this function.
 * The body calls the lock-free saveSecretKeyUnlocked so there is no nested
 * same-lock acquisition and no deadlock risk.
 */
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
