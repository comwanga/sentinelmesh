// Circle keys are stored as non-extractable CryptoKey objects in IndexedDB,
// keyed by (circleId, key_epoch). localStorage can only hold strings (forcing an
// extractable, exfiltratable key), so it is no longer used for keys — XSS cannot
// export a non-extractable key.
import { finalizeEvent, nip44, verifyEvent, type VerifiedEvent } from 'nostr-tools'
import { upsertCircleKey, removeVaultCircle, loadVaultCircleKey } from './identityStore'
import { getCachedKeypair } from './nostrService'
import { signWithActiveIdentity } from './signerService'

const LEGACY_KEY_PREFIX = 'sentinelmesh:circle_key:'
const DB_NAME = 'sentinelmesh'
const DB_VERSION = 1
const KEY_STORE = 'circle_keys'

const keyId = (circleId: string, epoch: number) => `${circleId}:${epoch}`

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
// clone. Keys from unwrapNip44CircleKey are already non-extractable.
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

/** Persist a circle key non-extractably in IndexedDB, keyed by (circle, epoch). */
export async function saveCircleKey(circleId: string, key: CryptoKey, epoch = 1): Promise<void> {
  const storable = await toNonExtractable(key)
  await idbPut(keyId(circleId, epoch), storable)
  if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_KEY_PREFIX + circleId)
}

/**
 * Persist a circle key from its RAW bytes: import it non-extractably into the
 * live store (XSS cannot export it) AND record the raw bytes in the device vault
 * so the backup can carry it (H-3 Layer 2). The caller's rawKey buffer is zeroed.
 * Use this at every site that originates a circle key (create, rotate, restore).
 */
export async function saveCircleKeyWithBackup(circleId: string, rawKey: Uint8Array, epoch = 1): Promise<void> {
  try {
    const liveKey = await crypto.subtle.importKey(
      'raw', rawKey as unknown as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
    )
    await idbPut(keyId(circleId, epoch), liveKey)
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_KEY_PREFIX + circleId)
    await upsertCircleKey(circleId, rawKey, epoch)
  } finally {
    new Uint8Array(rawKey.buffer, rawKey.byteOffset, rawKey.byteLength).fill(0)
  }
}

/** Load a circle key (non-extractable) at `epoch`. Migrates a legacy
 *  epoch-less key (stored under the bare circleId) to epoch 1 once. */
export async function loadCircleKey(circleId: string, epoch = 1): Promise<CryptoKey | null> {
  const existing = await idbGet(keyId(circleId, epoch))
  if (existing) return existing

  // Legacy keys from the pre-epoch store live under the bare circleId. They are
  // epoch-1 protocol-0 keys: migrate in place, never overwrite an epoch key.
  if (epoch === 1) {
    const legacy = await idbGet(circleId)
    if (legacy) {
      await idbPut(keyId(circleId, 1), legacy)
      await idbDelete(circleId)
      return legacy
    }
  }

  if (typeof localStorage !== 'undefined') {
    const b64 = localStorage.getItem(LEGACY_KEY_PREFIX + circleId)
    if (b64 && epoch === 1) {
      const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      try {
        const key = await crypto.subtle.importKey(
          'raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
        )
        await idbPut(keyId(circleId, 1), key)
        await upsertCircleKey(circleId, raw, 1)
        localStorage.removeItem(LEGACY_KEY_PREFIX + circleId)
        return key
      } finally {
        raw.fill(0)
      }
    }
  }
  return null
}

/** Delete a circle key at `epoch` (or every epoch when omitted) from storage. */
export async function clearCircleKey(circleId: string, epoch?: number): Promise<void> {
  if (epoch === undefined) {
    // Best-effort: clear the current/previous/next window plus the legacy slot.
    for (let e = 1; e <= 64; e++) await idbDelete(keyId(circleId, e))
    await idbDelete(circleId)
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_KEY_PREFIX + circleId)
    await removeVaultCircle(circleId)
    return
  }
  await idbDelete(keyId(circleId, epoch))
  if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_KEY_PREFIX + circleId)
  await removeVaultCircle(circleId, epoch)
}

/**
 * Rotate the circle key to `nextEpoch`: generate a fresh key, persist it
 * non-extractably (vault updated too), and return the fresh EXTRACTABLE key so
 * the caller can re-wrap it for the remaining members. The key is saved as the
 * pending epoch BEFORE the owner commits; a failed commit leaves it inert and it
 * is purged on the next load.
 */
export async function rotateCircleKey(circleId: string, nextEpoch: number): Promise<CryptoKey> {
  const fresh = await generateCircleKey() // extractable
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', fresh))
  await saveCircleKeyWithBackup(circleId, raw, nextEpoch) // zeroes the raw copy
  return fresh
}

/** Purge keys older than (currentEpoch - 1). Envelopes live ≤ 5 minutes, so the
 *  previous epoch is enough to decrypt in-flight envelopes. */
export async function purgeCircleKeyEpochs(circleId: string, currentEpoch: number): Promise<void> {
  const floor = Math.max(1, currentEpoch - 1)
  for (let e = 1; e < floor; e++) {
    await idbDelete(keyId(circleId, e))
    await removeVaultCircle(circleId, e)
  }
}

const CIRCLE_KEY_EVENT_KIND = 30079
const CIRCLE_KEY_EVENT_TYPE = 'sentinelmesh-circle-key-v2'

interface CircleKeyPackageV2 {
  version: 2
  type: typeof CIRCLE_KEY_EVENT_TYPE
  circle_id: string
  key_epoch: number
  algorithm: 'AES-256-GCM'
  key: string
  issued_at: number
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

function rawB64(raw: Uint8Array): string {
  return btoa(String.fromCharCode(...raw))
}

function decodeRawB64(value: string): Uint8Array {
  const raw = Uint8Array.from(atob(value), char => char.charCodeAt(0))
  if (raw.length !== 32) throw new Error('Invalid circle key package')
  return raw
}

function singleTag(event: VerifiedEvent, name: string): string | null {
  const matches = event.tags.filter(tag => tag[0] === name)
  if (matches.length !== 1) return null
  return matches[0]![1] ?? null
}

/**
 * Build and sign a v2 circle-key wrap (kind 30079) for `recipientPubkey` at
 * `keyEpoch`. The content is a NIP-44 v2 pairwise-encrypted v2 package whose tags
 * exactly bind d/circle/epoch/p. The recipient verifies the event and the trusted
 * local owner before decrypting.
 */
export async function createNip44CircleKeyEvent(
  circleId: string,
  recipientPubkey: string,
  keyEpoch: number,
): Promise<VerifiedEvent> {
  if (!/^[0-9a-f]{64}$/i.test(recipientPubkey)) throw new Error('Invalid recipient public key')
  if (!Number.isSafeInteger(keyEpoch) || keyEpoch < 1) throw new Error('Invalid key epoch')
  const rawKey = await loadVaultCircleKey(circleId, keyEpoch)
  if (!rawKey) throw new Error('Circle key is not available in the encrypted vault')
  const keypair = getCachedKeypair()
  try {
    const plaintext = JSON.stringify({
      version: 2,
      type: CIRCLE_KEY_EVENT_TYPE,
      circle_id: circleId,
      key_epoch: keyEpoch,
      algorithm: 'AES-256-GCM',
      key: rawB64(rawKey),
      issued_at: Math.floor(Date.now() / 1000),
    } satisfies CircleKeyPackageV2)
    const conversationKey = nip44.v2.utils.getConversationKey(keypair.secretKey, recipientPubkey)
    try {
      const content = nip44.v2.encrypt(plaintext, conversationKey)
      return finalizeEvent({
        kind: CIRCLE_KEY_EVENT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', CIRCLE_KEY_EVENT_TYPE],
          ['circle', circleId],
          ['epoch', String(keyEpoch)],
          ['p', recipientPubkey.toLowerCase()],
        ],
        content,
      }, keypair.secretKey)
    } finally {
      conversationKey.fill(0)
    }
  } finally {
    rawKey.fill(0)
  }
}

/**
 * Verify and unwrap a v2 circle-key wrap. The full signed event must bind the
 * trusted local owner, this circle, an epoch, and this recipient; the pairwise
 * NIP-44 plaintext must be a valid v2 package. Saves the key at the package's
 * epoch.
 */
export async function unwrapNip44CircleKey(
  circleId: string,
  ownerPubkey: string,
  event: VerifiedEvent,
): Promise<number> {
  const keypair = getCachedKeypair()
  if (!/^[0-9a-f]{64}$/.test(ownerPubkey)) throw new Error('Circle owner key is unavailable')
  if (!verifyEvent(event) || event.kind !== CIRCLE_KEY_EVENT_KIND) {
    throw new Error('Invalid circle key envelope')
  }
  if (event.pubkey !== ownerPubkey.toLowerCase()) {
    throw new Error('Circle key envelope is not signed by the trusted owner')
  }
  if (singleTag(event, 'd') !== CIRCLE_KEY_EVENT_TYPE
    || singleTag(event, 'circle') !== circleId
    || singleTag(event, 'p') !== keypair.publicKey.toLowerCase()) {
    throw new Error('Circle key envelope is not bound to this circle and recipient')
  }
  const epochTag = singleTag(event, 'epoch')
  if (!epochTag || !/^\d+$/.test(epochTag)) throw new Error('Circle key envelope has no valid epoch')
  const keyEpoch = Number(epochTag)

  const conversationKey = nip44.v2.utils.getConversationKey(keypair.secretKey, ownerPubkey)
  let rawKey: Uint8Array | null = null
  try {
    const plaintext = nip44.v2.decrypt(event.content, conversationKey)
    const value = JSON.parse(plaintext) as Partial<CircleKeyPackageV2>
    if (value.version !== 2 || value.type !== CIRCLE_KEY_EVENT_TYPE
      || value.circle_id !== circleId || value.key_epoch !== keyEpoch
      || value.algorithm !== 'AES-256-GCM' || typeof value.key !== 'string') {
      throw new Error('Invalid circle key package')
    }
    rawKey = decodeRawB64(value.key)
    await saveCircleKeyWithBackup(circleId, rawKey, keyEpoch)
  } catch {
    throw new Error('Invalid circle key envelope')
  } finally {
    conversationKey.fill(0)
    rawKey?.fill(0)
  }
  return keyEpoch
}

/**
 * Legacy protocol-0 read-only unwrap: the v1 circle-key package (no epoch) was
 * NIP-44 v2 pairwise-encrypted and stored as opaque ciphertext. It yields an
 * epoch-1 key usable only for name/label decryption — never live location.
 */
export async function unwrapLegacyCircleKey(
  circleId: string,
  ownerPubkey: string,
  ciphertext: string,
): Promise<void> {
  const keypair = getCachedKeypair()
  if (!/^[0-9a-f]{64}$/.test(ownerPubkey)) throw new Error('Circle owner key is unavailable')
  const conversationKey = nip44.v2.utils.getConversationKey(keypair.secretKey, ownerPubkey)
  let rawKey: Uint8Array | null = null
  try {
    const plaintext = nip44.v2.decrypt(ciphertext, conversationKey)
    const value = JSON.parse(plaintext) as Partial<{ version: number; circle_id: string; algorithm: string; key: string }>
    if (value.version !== 1 || value.circle_id !== circleId
      || value.algorithm !== 'AES-256-GCM' || typeof value.key !== 'string') {
      throw new Error('Invalid circle key envelope')
    }
    rawKey = decodeRawB64(value.key)
    await saveCircleKeyWithBackup(circleId, rawKey, 1)
  } catch {
    throw new Error('Invalid circle key envelope')
  } finally {
    conversationKey.fill(0)
    rawKey?.fill(0)
  }
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

export const CIRCLE_LOCATION_EVENT_KIND = 30080
const LOCATION_AAD_PREFIX = 'sentinelmesh:circle-location:v1'
const LOCATION_MAX_AGE_SECONDS = 5 * 60
const LOCATION_FUTURE_SKEW_SECONDS = 30

export type LocationPrecision = 'exact' | 'approximate'
export interface CircleLocationContentV1 {
  lat: number
  lng: number
  accuracy_m: number
  captured_at: number
  precision: LocationPrecision
}
export interface VerifiedCircleLocationV1 extends CircleLocationContentV1 {
  pubkey: string
  event_id: string
  expires_at: number
}

let approximateSessionGrid: {
  cellM: number
  latStep: number
  lngStep: number
  latOffset: number
  lngOffset: number
} | null = null

function locationAad(circleId: string, keyEpoch: number): Uint8Array {
  return new TextEncoder().encode(`${LOCATION_AAD_PREFIX}|${circleId}|${keyEpoch}`)
}

/** Stable, session-scoped 250-500m cell transform applied before signing. */
export function approximateLocationForSession(lat: number, lng: number): { lat: number; lng: number; cell_m: number } {
  if (!approximateSessionGrid) {
    const random = crypto.getRandomValues(new Uint32Array(3))
    const cellM = 250 + (random[0] % 251)
    const referenceCos = Math.max(Math.cos(lat * Math.PI / 180), 0.01)
    approximateSessionGrid = {
      cellM,
      latStep: cellM / 111_320,
      lngStep: cellM / (111_320 * referenceCos),
      latOffset: random[1] / 0x1_0000_0000,
      lngOffset: random[2] / 0x1_0000_0000,
    }
  }
  const { cellM, latStep, lngStep, latOffset, lngOffset } = approximateSessionGrid
  return {
    lat: (Math.floor(lat / latStep - latOffset) + latOffset + 0.5) * latStep,
    lng: (Math.floor(lng / lngStep - lngOffset) + lngOffset + 0.5) * lngStep,
    cell_m: cellM,
  }
}

function validCoordinateContent(value: unknown): value is CircleLocationContentV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort().join(',')
  return keys === 'accuracy_m,captured_at,lat,lng,precision'
    && typeof record.lat === 'number' && Number.isFinite(record.lat) && record.lat >= -90 && record.lat <= 90
    && typeof record.lng === 'number' && Number.isFinite(record.lng) && record.lng >= -180 && record.lng <= 180
    && typeof record.accuracy_m === 'number' && Number.isFinite(record.accuracy_m)
    && record.accuracy_m >= 0 && record.accuracy_m <= 100_000
    && typeof record.captured_at === 'number' && Number.isSafeInteger(record.captured_at)
    && (record.precision === 'exact' || record.precision === 'approximate')
}

function exactLocationTags(event: VerifiedEvent, circleId: string, keyEpoch: number): { expiresAt: number } | null {
  if (event.tags.length !== 4) return null
  const expected = new Map(event.tags.map(tag => [tag[0], tag]))
  if (expected.size !== 4 || [...expected.keys()].some(name => !['circle', 'epoch', 'expires', 'nonce'].includes(name))) return null
  const circle = expected.get('circle'); const epoch = expected.get('epoch')
  const expires = expected.get('expires'); const nonce = expected.get('nonce')
  if (!circle || circle.length !== 2 || circle[1] !== circleId
    || !epoch || epoch.length !== 2 || epoch[1] !== String(keyEpoch)
    || !expires || expires.length !== 2 || !/^\d+$/.test(expires[1])
    || !nonce || nonce.length !== 2 || !/^[0-9a-f-]{36}$/i.test(nonce[1])) return null
  const expiresAt = Number(expires[1])
  return Number.isSafeInteger(expiresAt) ? { expiresAt } : null
}

export async function encryptCircleLocationV1(
  circleKey: CryptoKey,
  circleId: string,
  keyEpoch: number,
  location: { lat: number; lng: number; accuracy_m: number; captured_at?: number },
  precision: LocationPrecision,
  expiresAt: number,
): Promise<string> {
  if (!circleId || !Number.isSafeInteger(keyEpoch) || keyEpoch < 1) throw new Error('Invalid circle location context')
  const capturedAt = location.captured_at ?? Math.floor(Date.now() / 1000)
  const transformed = precision === 'approximate'
    ? approximateLocationForSession(location.lat, location.lng)
    : { lat: location.lat, lng: location.lng, cell_m: 0 }
  const content: CircleLocationContentV1 = {
    lat: transformed.lat,
    lng: transformed.lng,
    accuracy_m: precision === 'approximate' ? Math.max(location.accuracy_m, transformed.cell_m) : location.accuracy_m,
    captured_at: capturedAt,
    precision,
  }
  if (!validCoordinateContent(content) || !Number.isSafeInteger(expiresAt)
    || expiresAt <= capturedAt || expiresAt > capturedAt + LOCATION_MAX_AGE_SECONDS) {
    throw new Error('Invalid circle location payload')
  }
  const event = await signWithActiveIdentity({
    kind: CIRCLE_LOCATION_EVENT_KIND,
    created_at: capturedAt,
    tags: [['circle', circleId], ['epoch', String(keyEpoch)], ['expires', String(expiresAt)], ['nonce', crypto.randomUUID()]],
    content: JSON.stringify(content),
  })
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: locationAad(circleId, keyEpoch) as unknown as BufferSource },
    circleKey,
    new TextEncoder().encode(JSON.stringify(event)),
  )
  return encodeB64(iv, ciphertext)
}

export async function decryptCircleLocationV1(
  circleKey: CryptoKey,
  ciphertextB64: string,
  circleId: string,
  keyEpoch: number,
  activeMemberPubkeys: ReadonlySet<string>,
  now = Math.floor(Date.now() / 1000),
): Promise<VerifiedCircleLocationV1 | null> {
  try {
    const decoded = decodeB64(ciphertextB64)
    if (!decoded) return null
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decoded.iv as unknown as BufferSource, additionalData: locationAad(circleId, keyEpoch) as unknown as BufferSource },
      circleKey,
      decoded.data as unknown as BufferSource,
    )
    const event = JSON.parse(new TextDecoder().decode(plaintext)) as VerifiedEvent
    if (!verifyEvent(event) || event.kind !== CIRCLE_LOCATION_EVENT_KIND
      || event.created_at > now + LOCATION_FUTURE_SKEW_SECONDS
      || !activeMemberPubkeys.has(event.pubkey.toLowerCase())) return null
    const tags = exactLocationTags(event, circleId, keyEpoch)
    if (!tags || tags.expiresAt <= now || tags.expiresAt > event.created_at + LOCATION_MAX_AGE_SECONDS) return null
    const content: unknown = JSON.parse(event.content)
    if (!validCoordinateContent(content) || content.captured_at !== event.created_at
      || content.captured_at > now + LOCATION_FUTURE_SKEW_SECONDS
      || content.captured_at < now - LOCATION_MAX_AGE_SECONDS) return null
    return { ...content, pubkey: event.pubkey, event_id: event.id, expires_at: tags.expiresAt }
  } catch {
    return null
  }
}
