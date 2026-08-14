// Persists the Nostr secret key encrypted at rest under a non-extractable AES
// key in IndexedDB. Same custody posture as the circle keys in e2eeService: the
// wrapping key can never be exported, and a stolen DB file yields only
// ciphertext. Uses its own IndexedDB database so it never has to coordinate a
// schema-version bump with the circle-key store. (H-3 Layer 1.)
import { getPublicKey } from 'nostr-tools'

const DB_NAME = 'sentinelmesh-identity'
const DB_VERSION = 1
const STORE = 'keys'
const WRAP_KEY_ID = 'identity-wrap-key'
const SK_ID = 'nostr-sk'
const META_ID = 'vault-meta'
export interface VaultMeta { lastExportedFingerprint: string }

// v1 stored only the raw secret key. v2 stores a structured vault payload so a
// backup can carry the identity AND the circle keys + ids. loadVault migrates a
// v1 record to v2 on first read.
const VAULT_VERSION = 2

export interface VaultCircle { id: string; key: Uint8Array; epoch?: number }      // raw 32-byte AES key at a key epoch
export interface VaultPayload { identitySk: Uint8Array; circles: VaultCircle[] }

interface VaultRecord { version: number; blob: Uint8Array } // blob = IV || AES-GCM(wrapKey, serialized payload)
interface ScopedVaultRecord { version: 1; blob: Uint8Array }

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
// Every public entry point that WRITES the vault record acquires this lock at
// its top level (clearSecretKey only deletes and is intentionally lock-free).
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
    circles: p.circles.map(c => ({ id: c.id, key: b64encode(c.key), epoch: c.epoch ?? 1 })),
  })
}

export function decodeVaultPayload(json: string): VaultPayload {
  const o = JSON.parse(json) as { identitySk: string; circles: Array<{ id: string; key: string; epoch?: number }> }
  return {
    identitySk: b64decode(o.identitySk),
    circles: (o.circles ?? []).map(c => ({ id: c.id, key: b64decode(c.key), epoch: c.epoch ?? 1 })),
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

/** Decrypt + parse the vault. A legacy v1 record (raw secret key) is migrated
 *  IN MEMORY to a v2 payload with empty circles; the on-disk rewrite to v2 is
 *  LAZY — it happens on the next saveVault/saveSecretKey (e.g. first circle add
 *  or identity change). loadVault must NOT rewrite here: it is called from inside
 *  the init lock (saveSecretKey/loadOrCreateSecretKey at boot), and re-acquiring
 *  the non-reentrant init lock would deadlock an upgrading Layer 1 user at boot.
 *  Returns null if absent or undecryptable. */
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
      // v1 plaintext is the raw 32-byte secret key — present it as a v2 payload.
      return { identitySk: plain, circles: [] }
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

/** Delete the whole vault record + export metadata (explicit identity reset).
 *  Dropping vault-meta too means the staleness badge starts from "no backup yet"
 *  for the new identity rather than comparing against a different identity's
 *  last-export fingerprint. */
export async function clearSecretKey(): Promise<void> {
  await idbDelete(SK_ID)
  await idbDelete(META_ID)
}

/** Test-only: write a legacy v1 record (raw secret key) to exercise migration.
 *  Guarded so it can never run in a production build (tree-shaking removes it
 *  when unused; this throws if somehow reached). */
export async function __writeLegacyV1ForTests(sk: Uint8Array): Promise<void> {
  if (import.meta.env.PROD) throw new Error('__writeLegacyV1ForTests is test-only')
  await withInitLock(async () => {
    const wrapKey = await getOrCreateWrapKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, sk as unknown as BufferSource)
    const blob = new Uint8Array(iv.byteLength + ct.byteLength)
    blob.set(iv); blob.set(new Uint8Array(ct), iv.byteLength)
    await idbPut(SK_ID, { version: 1, blob } as VaultRecord)
  })
}

/** Add or replace a circle's raw key in the vault, preserving identity + others. */
export async function upsertCircleKey(circleId: string, rawKey: Uint8Array, epoch = 1): Promise<void> {
  return withInitLock(async () => {
    const v = await loadVault()
    if (!v) return // no identity yet — nothing to attach a circle to
    const circles = v.circles.filter(c => !(c.id === circleId && (c.epoch ?? 1) === epoch))
    circles.push({ id: circleId, key: new Uint8Array(rawKey), epoch })
    await saveVaultUnlocked({ identitySk: v.identitySk, circles })
  })
}

/** Return a copy of a raw circle key from the encrypted vault for key distribution. */
export async function loadVaultCircleKey(circleId: string, epoch?: number): Promise<Uint8Array | null> {
  const vault = await loadVault()
  const entries = vault?.circles.filter(circle => circle.id === circleId) ?? []
  const entry = epoch === undefined
    ? entries.sort((a, b) => (b.epoch ?? 1) - (a.epoch ?? 1))[0]
    : entries.find(circle => (circle.epoch ?? 1) === epoch)
  return entry ? new Uint8Array(entry.key) : null
}

/** Remove a circle entry (optionally a specific epoch) from the vault. */
export async function removeVaultCircle(circleId: string, epoch?: number): Promise<void> {
  return withInitLock(async () => {
    const v = await loadVault()
    if (!v) return
    const circles = epoch === undefined
      ? v.circles.filter(c => c.id !== circleId)
      : v.circles.filter(c => !(c.id === circleId && (c.epoch ?? 1) === epoch))
    await saveVaultUnlocked({ identitySk: v.identitySk, circles })
  })
}

/** Read/write the separate, non-secret export-metadata record. */
export async function loadVaultMeta(): Promise<VaultMeta | null> { return idbGet<VaultMeta>(META_ID) }
export async function saveVaultMeta(meta: VaultMeta): Promise<void> { await idbPut(META_ID, meta) }

/** Encrypt an application-scoped record under the device's non-extractable key. */
export async function saveScopedDeviceRecord(scope: 'home-location', plaintext: Uint8Array): Promise<void> {
  await withInitLock(async () => {
    const key = await getOrCreateWrapKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const additionalData = new TextEncoder().encode(scope)
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData }, key, plaintext as unknown as BufferSource,
    )
    const blob = new Uint8Array(iv.byteLength + ciphertext.byteLength)
    blob.set(iv)
    blob.set(new Uint8Array(ciphertext), iv.byteLength)
    await idbPut(`scoped:${scope}`, { version: 1, blob } satisfies ScopedVaultRecord)
  })
}

/** Decrypt an application-scoped record without exposing the device key. */
export async function loadScopedDeviceRecord(scope: 'home-location'): Promise<Uint8Array | null> {
  const key = await idbGet<CryptoKey>(WRAP_KEY_ID)
  const record = await idbGet<ScopedVaultRecord>(`scoped:${scope}`)
  if (!key || !record || record.version !== 1 || !(record.blob instanceof Uint8Array) || record.blob.byteLength < 29) return null
  const iv = record.blob.slice(0, 12)
  const ciphertext = record.blob.slice(12)
  const additionalData = new TextEncoder().encode(scope)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData }, key, ciphertext as unknown as BufferSource,
  )
  return new Uint8Array(plaintext)
}

export async function clearScopedDeviceRecord(scope: 'home-location'): Promise<void> {
  await idbDelete(`scoped:${scope}`)
}

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
