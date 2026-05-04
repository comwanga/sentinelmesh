// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import {
  generateCircleKey,
  saveCircleKey,
  loadCircleKey,
  clearCircleKey,
  encryptLocation,
  decryptLocation,
  generateEphemeralKeypair,
  wrapCircleKey,
  unwrapCircleKey,
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
  it('round-trips a circle key through localStorage', async () => {
    const key = await generateCircleKey()
    await saveCircleKey('test-circle', key)

    const loaded = await loadCircleKey('test-circle')
    expect(loaded).not.toBeNull()
    expect(loaded!.type).toBe('secret')

    clearCircleKey('test-circle')
    expect(await loadCircleKey('test-circle')).toBeNull()
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
