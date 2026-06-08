// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { saveSecretKey, loadSecretKey, clearSecretKey, loadOrCreateSecretKey } from '../identityStore'

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
    expect(rec!.version).toBe(1)
    // Blob is IV (12) + GCM ciphertext (32) + GCM tag (16) = 60 bytes minimum.
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
