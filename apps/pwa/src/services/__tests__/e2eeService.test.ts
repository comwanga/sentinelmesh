// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  generateCircleKey,
  saveCircleKey,
  loadCircleKey,
  clearCircleKey,
  rotateCircleKey,
  encryptLocation,
  decryptLocation,
  createNip44CircleKeyEvent,
  unwrapNip44CircleKey,
  encryptString,
  decryptString,
  saveCircleKeyWithBackup,
  encryptCircleLocationV1,
  decryptCircleLocationV1,
  approximateLocationForSession,
} from '../e2eeService'
import { loadVault, saveSecretKey } from '../identityStore'
import { __resetIdentityCacheForTests, loadIdentity } from '../nostrService'
import { generateSecretKey, getPublicKey } from 'nostr-tools'

function rawKey(n: number): Uint8Array {
  const k = new Uint8Array(32); for (let i = 0; i < 32; i++) k[i] = (i + n) & 0xff; return k
}

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

describe('signed CircleLocationEnvelopeV1 crypto', () => {
  it('signs, encrypts, and strictly verifies the complete inner event', async () => {
    await saveSecretKey(rawKey(31)); __resetIdentityCacheForTests()
    const identity = await loadIdentity()
    const key = await generateCircleKey()
    const now = Math.floor(Date.now() / 1000)
    const ciphertext = await encryptCircleLocationV1(key, 'circle-safe', 4, {
      lat: -1.2921, lng: 36.8219, accuracy_m: 12, captured_at: now,
    }, 'exact', now + 240)
    const result = await decryptCircleLocationV1(key, ciphertext, 'circle-safe', 4, new Set([identity.publicKey]), now)
    expect(result).toMatchObject({ lat: -1.2921, lng: 36.8219, accuracy_m: 12, precision: 'exact', pubkey: identity.publicKey })
    expect(result!.event_id).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects tampering, wrong key, circle, epoch, expiry, and nonmembers', async () => {
    await saveSecretKey(rawKey(32)); __resetIdentityCacheForTests()
    const identity = await loadIdentity()
    const key = await generateCircleKey(); const wrong = await generateCircleKey()
    const now = Math.floor(Date.now() / 1000)
    const ciphertext = await encryptCircleLocationV1(key, 'circle-bound', 2, {
      lat: 1, lng: 2, accuracy_m: 5, captured_at: now,
    }, 'exact', now + 60)
    const bytes = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0)); bytes[bytes.length - 1] ^= 1
    const tampered = btoa(String.fromCharCode(...bytes))
    const members = new Set([identity.publicKey])
    expect(await decryptCircleLocationV1(key, tampered, 'circle-bound', 2, members, now)).toBeNull()
    expect(await decryptCircleLocationV1(wrong, ciphertext, 'circle-bound', 2, members, now)).toBeNull()
    expect(await decryptCircleLocationV1(key, ciphertext, 'wrong-circle', 2, members, now)).toBeNull()
    expect(await decryptCircleLocationV1(key, ciphertext, 'circle-bound', 3, members, now)).toBeNull()
    expect(await decryptCircleLocationV1(key, ciphertext, 'circle-bound', 2, members, now + 61)).toBeNull()
    expect(await decryptCircleLocationV1(key, ciphertext, 'circle-bound', 2, new Set(), now)).toBeNull()
  })

  it('rejects invalid coordinates and applies a stable 250-500m approximate cell before signing', async () => {
    const key = await generateCircleKey(); const now = Math.floor(Date.now() / 1000)
    await expect(encryptCircleLocationV1(key, 'circle', 1, {
      lat: 91, lng: 0, accuracy_m: 1, captured_at: now,
    }, 'exact', now + 60)).rejects.toThrow('Invalid circle location payload')
    const first = approximateLocationForSession(-1.2921, 36.8219)
    const second = approximateLocationForSession(-1.2921, 36.8219)
    expect(second).toEqual(first)
    expect(first.cell_m).toBeGreaterThanOrEqual(250)
    expect(first.cell_m).toBeLessThanOrEqual(500)
  })
})

describe('NIP-44 circle key distribution', () => {
  it('lets the intended member import a key that decrypts existing AES content', async () => {
    const owner = rawKey(11)
    const recipient = rawKey(44)
    await saveSecretKey(owner)
    __resetIdentityCacheForTests()
    await loadIdentity()
    await saveCircleKeyWithBackup('circle-nip44', rawKey(7))
    const ownerKey = await loadCircleKey('circle-nip44')
    const ciphertext = await encryptLocation(ownerKey!, -1.0, 36.0)
    const event = await createNip44CircleKeyEvent('circle-nip44', getPublicKey(recipient))
    expect(event.content).not.toContain(rawKey(7).toString())

    await clearCircleKey('circle-nip44')
    await saveSecretKey(recipient)
    __resetIdentityCacheForTests()
    await loadIdentity()
    await unwrapNip44CircleKey('circle-nip44', event.pubkey, event.content)
    const imported = await loadCircleKey('circle-nip44')
    expect((await decryptLocation(imported!, ciphertext))!.lat).toBeCloseTo(-1.0)
  })

  it('rejects the wrong circle and recipient', async () => {
    const owner = rawKey(12)
    const recipient = rawKey(45)
    await saveSecretKey(owner)
    __resetIdentityCacheForTests()
    await loadIdentity()
    await saveCircleKeyWithBackup('circle-bound', rawKey(8))
    const event = await createNip44CircleKeyEvent('circle-bound', getPublicKey(recipient))
    await saveSecretKey(recipient)
    __resetIdentityCacheForTests()
    await loadIdentity()
    await expect(unwrapNip44CircleKey('other-circle', event.pubkey, event.content)).rejects.toThrow('Invalid circle key envelope')

    await saveSecretKey(generateSecretKey())
    __resetIdentityCacheForTests()
    await loadIdentity()
    await expect(unwrapNip44CircleKey('circle-bound', event.pubkey, event.content)).rejects.toThrow('Invalid circle key envelope')
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
