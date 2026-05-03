const CIRCLE_KEY_PREFIX = 'sentinelmesh:circle_key:'

export async function generateCircleKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

export async function saveCircleKey(circleId: string, key: CryptoKey): Promise<void> {
  const raw = await crypto.subtle.exportKey('raw', key)
  const b64 = btoa(String.fromCharCode(...new Uint8Array(raw)))
  localStorage.setItem(CIRCLE_KEY_PREFIX + circleId, b64)
}

export async function loadCircleKey(circleId: string): Promise<CryptoKey | null> {
  const b64 = localStorage.getItem(CIRCLE_KEY_PREFIX + circleId)
  if (!b64) return null
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export function clearCircleKey(circleId: string): void {
  localStorage.removeItem(CIRCLE_KEY_PREFIX + circleId)
}

export async function generateEphemeralKeypair(): Promise<{ publicKey: Uint8Array; privateKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'X25519' } as AlgorithmIdentifier, true, ['deriveKey', 'deriveBits'])
  const rawPub = await crypto.subtle.exportKey('raw', (pair as CryptoKeyPair).publicKey)
  return { publicKey: new Uint8Array(rawPub), privateKey: (pair as CryptoKeyPair).privateKey }
}

async function deriveWrappingKey(myPrivKey: CryptoKey, theirPubBytes: Uint8Array): Promise<CryptoKey> {
  const theirPub = await crypto.subtle.importKey('raw', theirPubBytes, { name: 'X25519' } as AlgorithmIdentifier, false, [])
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
    if (bytes.length < 13) return null
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

export async function unwrapCircleKey(
  wrappedB64: string,
  myPrivKey: CryptoKey,
  theirPubBytes: Uint8Array,
): Promise<CryptoKey> {
  const wrappingKey = await deriveWrappingKey(myPrivKey, theirPubBytes)
  const decoded = decodeB64(wrappedB64)
  if (!decoded) throw new Error('Invalid wrapped key encoding')
  const rawCircleKey = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decoded.iv }, wrappingKey, decoded.data)
  return crypto.subtle.importKey('raw', rawCircleKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
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
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decoded.iv }, circleKey, decoded.data)
    return JSON.parse(new TextDecoder().decode(plain)) as { lat: number; lng: number; ts: string }
  } catch {
    return null
  }
}
