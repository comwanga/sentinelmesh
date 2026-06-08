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

// Lock-free internal: encrypt sk with the wrap key and write the vault record.
// Must only be called from within an already-held init lock so that wrap-key
// creation and ciphertext write are serialized cross-tab.
async function saveSecretKeyUnlocked(sk: Uint8Array): Promise<void> {
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

/** Encrypt and store the raw 32-byte Nostr secret key as a versioned envelope.
 *  Serialized under the init lock so concurrent tab calls can't clobber the
 *  wrap key and make earlier ciphertext undecryptable. */
export async function saveSecretKey(sk: Uint8Array): Promise<void> {
  return withInitLock(() => saveSecretKeyUnlocked(sk))
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
 *
 * Lock design: withInitLock is acquired once at the top of this function.
 * The body calls the lock-free saveSecretKeyUnlocked so there is no nested
 * same-lock acquisition and no deadlock risk.
 */
export async function loadOrCreateSecretKey(generate: () => Uint8Array): Promise<Uint8Array> {
  return withInitLock(async () => {
    const existing = await loadSecretKey()
    if (existing) return existing
    const sk = generate()
    await saveSecretKeyUnlocked(sk)
    return (await loadSecretKey()) ?? sk
  })
}

/** Delete the stored secret key (used by the explicit identity reset). */
export async function clearSecretKey(): Promise<void> {
  await idbDelete(SK_ID)
}
