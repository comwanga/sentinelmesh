// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { saveSecretKey, loadSecretKey, clearSecretKey, loadOrCreateSecretKey, loadVault, saveVault, encodeVaultPayload, decodeVaultPayload, type VaultPayload, __writeLegacyV1ForTests } from '../identityStore'

// Distinct 32-byte key for assertions.
function sampleKey(): Uint8Array {
  const k = new Uint8Array(32)
  for (let i = 0; i < 32; i++) k[i] = (i * 7 + 1) & 0xff
  return k
}

// Open the raw IDB vault record without going through identityStore helpers.
function readRawVault(): Promise<{ version: number; blob: Uint8Array } | null> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sentinelmesh-identity', 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('keys')) req.result.createObjectStore('keys')
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('keys', 'readonly')
      const r = tx.objectStore('keys').get('nostr-sk')
      r.onsuccess = () => { db.close(); resolve((r.result as any) ?? null) }
      r.onerror = () => { db.close(); reject(r.error) }
    }
    req.onerror = () => reject(req.error)
  })
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

    const rec = await readRawVault()
    expect(rec).not.toBeNull()
    expect(rec!.version).toBe(2)
    // Blob is IV (12) + AES-GCM ciphertext + GCM tag (16) — always > 32 bytes.
    expect(rec!.blob.byteLength).toBeGreaterThan(32)

    // The raw 32 key bytes must NOT appear as a contiguous subsequence of the blob.
    const blob = rec!.blob
    let found = false
    outer: for (let i = 0; i <= blob.byteLength - sk.byteLength; i++) {
      for (let j = 0; j < sk.byteLength; j++) {
        if (blob[i + j] !== sk[j]) continue outer
      }
      found = true
      break
    }
    expect(found).toBe(false)
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
    expect(Array.from((await loadSecretKey())!)).toEqual(Array.from(sk))
  })
})

function sk(n: number): Uint8Array {
  const k = new Uint8Array(32)
  for (let i = 0; i < 32; i++) k[i] = (i * 13 + n) & 0xff
  return k
}

describe('identityStore v2 vault', () => {
  beforeEach(async () => { await clearSecretKey() })

  it('encode/decode round-trips a payload with circles', () => {
    const payload: VaultPayload = { identitySk: sk(1), circles: [{ id: 'c-1', key: sk(2) }, { id: 'c-2', key: sk(3) }] }
    const decoded = decodeVaultPayload(encodeVaultPayload(payload))
    expect(Array.from(decoded.identitySk)).toEqual(Array.from(sk(1)))
    expect(decoded.circles.map(c => c.id)).toEqual(['c-1', 'c-2'])
    expect(Array.from(decoded.circles[1]!.key)).toEqual(Array.from(sk(3)))
  })

  it('saveVault then loadVault round-trips identity + circles', async () => {
    await saveVault({ identitySk: sk(5), circles: [{ id: 'c-9', key: sk(6) }] })
    const v = await loadVault()
    expect(v).not.toBeNull()
    expect(Array.from(v!.identitySk)).toEqual(Array.from(sk(5)))
    expect(v!.circles).toHaveLength(1)
    expect(v!.circles[0]!.id).toBe('c-9')
    expect(Array.from(v!.circles[0]!.key)).toEqual(Array.from(sk(6)))
  })

  it('loadVault returns null when nothing is stored', async () => {
    expect(await loadVault()).toBeNull()
  })

  it('Layer 1 saveSecretKey writes a v2 vault; loadSecretKey reads it back', async () => {
    await saveSecretKey(sk(7))
    expect(Array.from((await loadSecretKey())!)).toEqual(Array.from(sk(7)))
    const v = await loadVault()
    expect(v!.circles).toEqual([])
  })

  it('saveSecretKey preserves existing circles', async () => {
    await saveVault({ identitySk: sk(1), circles: [{ id: 'keep', key: sk(2) }] })
    await saveSecretKey(sk(8))
    const v = await loadVault()
    expect(Array.from(v!.identitySk)).toEqual(Array.from(sk(8)))
    expect(v!.circles.map(c => c.id)).toEqual(['keep'])
  })

  it('migrates a legacy v1 record to a v2 vault with empty circles', async () => {
    await __writeLegacyV1ForTests(sk(4))
    const v = await loadVault()
    expect(Array.from(v!.identitySk)).toEqual(Array.from(sk(4)))
    expect(v!.circles).toEqual([])
    expect(Array.from((await loadSecretKey())!)).toEqual(Array.from(sk(4)))
  })

  it('reads a v1 record through the boot path and returns the existing key', async () => {
    // loadOrCreateSecretKey runs loadVault INSIDE the init lock. The real-browser
    // no-deadlock guarantee is a code-structure invariant (loadVault never calls
    // withInitLock); this env has no Web Locks shim, so the test asserts the
    // functional outcome: an upgrading Layer 1 user's v1 key is returned and the
    // generator is NOT run.
    await __writeLegacyV1ForTests(sk(4))
    const got = await loadOrCreateSecretKey(() => sk(99)) // generator must NOT run
    expect(Array.from(got)).toEqual(Array.from(sk(4)))
  })
})
