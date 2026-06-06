// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll } from 'vitest'
import {
  generateCircleKey,
  saveCircleKey,
  loadCircleKey,
  clearCircleKey,
  rotateCircleKey,
  encryptLocation,
  decryptLocation,
  generateEphemeralKeypair,
  wrapCircleKey,
  unwrapCircleKey,
  encryptString,
  decryptString,
} from '../e2eeService'

beforeAll(() => {
  // Provide localStorage mock for Node environment
  const store: Record<string, string> = {}
  ;(global as any).localStorage = {
    store,
    getItem(k: string) { return store[k] ?? null },
    setItem(k: string, v: string) { store[k] = v },
    removeItem(k: string) { delete store[k] },
  }
})

describe('generateCircleKey', () => {
  it('returns a CryptoKey for AES-GCM', async () => {
    const key = await generateCircleKey()
    expect(key.type).toBe('secret')
    expect(key.algorithm.name).toBe('AES-GCM')
  })
})

describe('saveCircleKey / loadCircleKey / clearCircleKey', () => {
  it('round-trips a circle key through IndexedDB', async () => {
    const key = await generateCircleKey()
    await saveCircleKey('test-circle', key)

    const loaded = await loadCircleKey('test-circle')
    expect(loaded).not.toBeNull()
    expect(loaded!.type).toBe('secret')

    await clearCircleKey('test-circle')
    expect(await loadCircleKey('test-circle')).toBeNull()
  })

  it('persists the key as non-extractable (XSS cannot export it)', async () => {
    const key = await generateCircleKey()
    expect(key.extractable).toBe(true) // generated extractable for distribution
    await saveCircleKey('hardened-circle', key)
    const loaded = await loadCircleKey('hardened-circle')
    expect(loaded!.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', loaded!)).rejects.toThrow()
    await clearCircleKey('hardened-circle')
  })
})

describe('rotateCircleKey', () => {
  it('replaces the stored key; old key no longer decrypts new blobs', async () => {
    const old = await generateCircleKey()
    await saveCircleKey('rot-circle', old)
    const oldCipher = await encryptLocation(old, 1.0, 2.0)

    const fresh = await rotateCircleKey('rot-circle')
    expect(fresh.extractable).toBe(true) // returned extractable for re-wrapping to remaining members

    const loaded = await loadCircleKey('rot-circle')
    expect(loaded!.extractable).toBe(false) // persisted copy is hardened
    // The rotated key cannot read blobs encrypted under the pre-rotation key
    expect(await decryptLocation(loaded!, oldCipher)).toBeNull()
    // but does read blobs encrypted under the fresh key
    const freshCipher = await encryptLocation(fresh, 3.0, 4.0)
    const dec = await decryptLocation(loaded!, freshCipher)
    expect(dec!.lat).toBeCloseTo(3.0)

    await clearCircleKey('rot-circle')
  })
})

describe('encryptLocation / decryptLocation', () => {
  it('round-trips lat/lng', async () => {
    const key = await generateCircleKey()
    const ciphertext = await encryptLocation(key, -1.2921, 36.8219)
    const result = await decryptLocation(key, ciphertext)
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(-1.2921)
    expect(result!.lng).toBeCloseTo(36.8219)
    expect(result!.ts).toBeDefined()
  })

  it('returns null for corrupted ciphertext', async () => {
    const key = await generateCircleKey()
    const result = await decryptLocation(key, 'bm90dmFsaWQ=')
    expect(result).toBeNull()
  })
})

describe('wrapCircleKey / unwrapCircleKey', () => {
  it('round-trips a circle key through X25519 wrapping', async () => {
    const circleKey = await generateCircleKey()
    const inviter = await generateEphemeralKeypair()
    const recipient = await generateEphemeralKeypair()

    const wrapped = await wrapCircleKey(circleKey, inviter.privateKey, recipient.publicKey)
    const unwrapped = await unwrapCircleKey(wrapped, recipient.privateKey, inviter.publicKey)

    // Verify the unwrapped key can decrypt what the original encrypted
    const ciphertext = await encryptLocation(circleKey, -1.0, 36.0)
    const result = await decryptLocation(unwrapped, ciphertext)
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(-1.0)
  })
})

describe('encryptString/decryptString', () => {
  it('round-trips a UTF-8 string under the circle key', async () => {
    const key = await generateCircleKey()
    const ct = await encryptString(key, 'Family Emergency Circle 🌍')
    expect(ct).not.toContain('Family')
    expect(await decryptString(key, ct)).toBe('Family Emergency Circle 🌍')
  })

  it('returns null when decrypting with the wrong key', async () => {
    const a = await generateCircleKey()
    const b = await generateCircleKey()
    const ct = await encryptString(a, 'secret')
    expect(await decryptString(b, ct)).toBeNull()
  })

  it('returns null on malformed ciphertext', async () => {
    const key = await generateCircleKey()
    expect(await decryptString(key, 'not-base64-$$')).toBeNull()
  })
})
