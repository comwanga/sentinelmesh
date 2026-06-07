// Circle keys are stored as non-extractable CryptoKey objects in IndexedDB.
// localStorage can only hold strings (forcing an extractable, exfiltratable key),
// so it is no longer used for keys — XSS cannot export a non-extractable key.
const LEGACY_KEY_PREFIX = 'sentinelmesh:circle_key:'
const DB_NAME = 'sentinelmesh'
const DB_VERSION = 1
const KEY_STORE = 'circle_keys'

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(KEY_STORE)) {
        req.result.createObjectStore(KEY_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbPut(id: string, key: CryptoKey): Promise<void> {
  return openKeyDb().then(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readwrite')
    tx.objectStore(KEY_STORE).put(key, id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
    tx.onabort = () => { db.close(); reject(tx.error) }
  }))
}

function idbGet(id: string): Promise<CryptoKey | null> {
  return openKeyDb().then(db => new Promise<CryptoKey | null>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readonly')
    const req = tx.objectStore(KEY_STORE).get(id)
    req.onsuccess = () => { db.close(); resolve((req.result as CryptoKey | undefined) ?? null) }
    req.onerror = () => { db.close(); reject(req.error) }
  }))
}

function idbDelete(id: string): Promise<void> {
  return openKeyDb().then(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readwrite')
    tx.objectStore(KEY_STORE).delete(id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  }))
}

// Ensure a key is non-extractable before persisting. Keys from generateCircleKey
// are extractable (needed to wrap for distribution); we store a non-extractable
// clone. Keys from unwrapCircleKey are already non-extractable.
async function toNonExtractable(key: CryptoKey): Promise<CryptoKey> {
  if (!key.extractable) return key
  const raw = await crypto.subtle.exportKey('raw', key)
  const nonExtractable = await crypto.subtle.importKey(
    'raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
  )
  new Uint8Array(raw).fill(0)
  return nonExtractable
}

/**
 * Generate a fresh circle key. Extractable so the owner can wrap it for members;
 * the persisted copy (see saveCircleKey) is always downgraded to non-extractable.
 */
export async function generateCircleKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

/** Persist a circle key non-extractably in IndexedDB (never localStorage). */
export async function saveCircleKey(circleId: string, key: CryptoKey): Promise<void> {
  const storable = await toNonExtractable(key)
  await idbPut(circleId, storable)
  if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_KEY_PREFIX + circleId)
}

/** Load a circle key (non-extractable). Migrates a legacy localStorage key once. */
export async function loadCircleKey(circleId: string): Promise<CryptoKey | null> {
  const existing = await idbGet(circleId)
  if (existing) return existing

  if (typeof localStorage !== 'undefined') {
    const b64 = localStorage.getItem(LEGACY_KEY_PREFIX + circleId)
    if (b64) {
      const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      const key = await crypto.subtle.importKey(
        'raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
      )
      await idbPut(circleId, key)
      localStorage.removeItem(LEGACY_KEY_PREFIX + circleId)
      return key
    }
  }
  return null
}

/** Delete a circle key from storage. */
export async function clearCircleKey(circleId: string): Promise<void> {
  await idbDelete(circleId)
  if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_KEY_PREFIX + circleId)
}

/**
 * Rotate the circle key after a membership change (e.g. removing a member):
 * generate a fresh key, persist it non-extractably, and return the fresh
 * EXTRACTABLE key so the caller can re-wrap it for the remaining members. A
 * removed member keeps only the old key, which no longer decrypts new location
 * blobs — forward secrecy across membership changes.
 */
export async function rotateCircleKey(circleId: string): Promise<CryptoKey> {
  const fresh = await generateCircleKey()
  await saveCircleKey(circleId, fresh)
  return fresh
}

export async function generateEphemeralKeypair(): Promise<{ publicKey: Uint8Array; privateKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'X25519' } as AlgorithmIdentifier, false, ['deriveBits'])
  const rawPub = await crypto.subtle.exportKey('raw', (pair as CryptoKeyPair).publicKey)
  return { publicKey: new Uint8Array(rawPub), privateKey: (pair as CryptoKeyPair).privateKey }
}

async function deriveWrappingKey(myPrivKey: CryptoKey, theirPubBytes: Uint8Array): Promise<CryptoKey> {
  const theirPub = await crypto.subtle.importKey('raw', theirPubBytes as unknown as BufferSource, { name: 'X25519' } as AlgorithmIdentifier, false, [])
  const bits = await crypto.subtle.deriveBits({ name: 'X25519', public: theirPub } as AlgorithmIdentifier, myPrivKey, 256)
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function encodeB64(iv: Uint8Array, data: ArrayBuffer): string {
  const combined = new Uint8Array(iv.byteLength + data.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(data), iv.byteLength)
  return btoa(String.fromCharCode(...combined))
}

function decodeB64(b64: string): { iv: Uint8Array; data: Uint8Array } | null {
  try {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    if (bytes.length < 28) return null
    return { iv: bytes.slice(0, 12), data: bytes.slice(12) }
  } catch {
    return null
  }
}

export async function wrapCircleKey(
  circleKey: CryptoKey,
  myPrivKey: CryptoKey,
  theirPubBytes: Uint8Array,
): Promise<string> {
  const wrappingKey = await deriveWrappingKey(myPrivKey, theirPubBytes)
  const rawCircleKey = await crypto.subtle.exportKey('raw', circleKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, rawCircleKey)
  return encodeB64(iv, wrapped)
}

/**
 * @throws {Error} if the wrapped key encoding is invalid or decryption fails (wrong keypair)
 */
export async function unwrapCircleKey(
  wrappedB64: string,
  myPrivKey: CryptoKey,
  theirPubBytes: Uint8Array,
): Promise<CryptoKey> {
  const wrappingKey = await deriveWrappingKey(myPrivKey, theirPubBytes)
  const decoded = decodeB64(wrappedB64)
  if (!decoded) throw new Error('Invalid wrapped key encoding')
  const rawCircleKey = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decoded.iv as unknown as BufferSource }, wrappingKey, decoded.data as unknown as BufferSource)
  return crypto.subtle.importKey('raw', rawCircleKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** AES-GCM encrypt a UTF-8 string under the circle key (random 12-byte IV). */
export async function encryptString(circleKey: CryptoKey, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, circleKey, new TextEncoder().encode(text),
  )
  return encodeB64(iv, ciphertext)
}

/** Decrypt a string produced by encryptString. Returns null on any failure. */
export async function decryptString(circleKey: CryptoKey, ciphertextB64: string): Promise<string | null> {
  try {
    const decoded = decodeB64(ciphertextB64)
    if (!decoded) return null
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decoded.iv as unknown as BufferSource },
      circleKey,
      decoded.data as unknown as BufferSource,
    )
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}

export async function encryptLocation(circleKey: CryptoKey, lat: number, lng: number): Promise<string> {
  const payload = JSON.stringify({ lat, lng, ts: new Date().toISOString() })
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, circleKey, enc.encode(payload))
  return encodeB64(iv, ciphertext)
}

export async function decryptLocation(
  circleKey: CryptoKey,
  ciphertextB64: string,
): Promise<{ lat: number; lng: number; ts: string } | null> {
  try {
    const decoded = decodeB64(ciphertextB64)
    if (!decoded) return null
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decoded.iv as unknown as BufferSource }, circleKey, decoded.data as unknown as BufferSource)
    return JSON.parse(new TextDecoder().decode(plain)) as { lat: number; lng: number; ts: string }
  } catch {
    return null
  }
}
