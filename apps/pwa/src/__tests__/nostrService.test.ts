import { vi, describe, it, test, expect, beforeEach, afterEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

// Provide a fresh fake IndexedDB for each test file run so identityStore
// can call indexedDB.open() without needing a real browser environment.
vi.stubGlobal('indexedDB', new IDBFactory())

// Minimal localStorage stub — used to verify we do NOT call it
const lsStore: Record<string, string> = {}
const localStorageMock = {
  getItem:    (k: string) => lsStore[k] ?? null,
  setItem:    (k: string, v: string) => { lsStore[k] = v },
  removeItem: (k: string) => { delete lsStore[k] },
  clear:      () => { Object.keys(lsStore).forEach(k => delete lsStore[k]) },
}
vi.stubGlobal('localStorage', localStorageMock)

beforeEach(() => localStorageMock.clear())
afterEach(() => { delete (window as unknown as Record<string, unknown>).nostr })

import {
  loadIdentity,
  getCachedKeypair,
  generateNewIdentity,
  __resetIdentityCacheForTests,
  importFromNsec,
  signReport,
  reportBindingContent,
  voteBindingContent,
  vouchBindingContent,
  vouchRevokeBindingContent,
  hasNip07,
  signAuthEvent,
  signNip98AuthEvent,
  clearStoredKey,
} from '../services/nostrService'

import { loadSecretKey, clearSecretKey } from '../services/identityStore'

describe('loadIdentity (persistent)', () => {
  beforeEach(async () => { await clearSecretKey(); __resetIdentityCacheForTests() })

  it('returns a valid 32-byte keypair', async () => {
    const kp = await loadIdentity()
    expect(kp.secretKey.length).toBe(32)
    expect(kp.publicKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('persists and returns the SAME pubkey across reloads', async () => {
    const first = await loadIdentity()
    __resetIdentityCacheForTests()
    const second = await loadIdentity()
    expect(second.publicKey).toBe(first.publicKey)
  })

  it('never regenerates when a key already exists', async () => {
    const first = await loadIdentity()
    const stored = await loadSecretKey()
    expect(stored).not.toBeNull()
    const again = await loadIdentity()
    expect(again.publicKey).toBe(first.publicKey)
  })

  it('does not generate twice under concurrent boot (shared init promise)', async () => {
    await clearSecretKey()
    __resetIdentityCacheForTests()
    const [a, b] = await Promise.all([loadIdentity(), loadIdentity()])
    expect(a.publicKey).toBe(b.publicKey)
    expect(await loadSecretKey()).not.toBeNull()
  })
})

describe('importFromNsec (persists)', () => {
  beforeEach(async () => { await clearSecretKey(); __resetIdentityCacheForTests() })

  it('imports and persists the key (survives a reload)', async () => {
    const seed = await loadIdentity()
    const nsec = (await import('../services/nostrService')).toNsec(seed.secretKey)
    __resetIdentityCacheForTests()
    const imported = await importFromNsec(nsec)
    expect(imported).not.toBeNull()
    expect(imported!.publicKey).toBe(seed.publicKey)
    __resetIdentityCacheForTests()
    const reloaded = await loadIdentity()
    expect(reloaded.publicKey).toBe(seed.publicKey)
  })
})

describe('generateNewIdentity (explicit reset)', () => {
  beforeEach(async () => { await clearSecretKey(); __resetIdentityCacheForTests() })

  it('replaces the identity with a new persisted pubkey', async () => {
    const before = await loadIdentity()
    const after = await generateNewIdentity()
    expect(after.publicKey).not.toBe(before.publicKey)
    __resetIdentityCacheForTests()
    const reloaded = await loadIdentity()
    expect(reloaded.publicKey).toBe(after.publicKey)
  })
})

describe('hasNip07', () => {
  test('returns false when window.nostr is absent', () => {
    expect(hasNip07()).toBe(false)
  })

  test('returns true when window.nostr is present', () => {
    ;(window as unknown as Record<string, unknown>).nostr = { getPublicKey: vi.fn(), signEvent: vi.fn() }
    expect(hasNip07()).toBe(true)
  })
})

describe('signAuthEvent', () => {
  test('uses NIP-07 when available', async () => {
    const fakeEvent = { id: 'abc', pubkey: 'xyz', created_at: 1, kind: 27235, tags: [], content: '', sig: 'sig' }
    const signEvent = vi.fn().mockResolvedValue(fakeEvent)
    ;(window as unknown as Record<string, unknown>).nostr = { signEvent, getPublicKey: vi.fn() }

    const result = await signAuthEvent()
    expect(signEvent).toHaveBeenCalledOnce()
    expect(result).toBe(fakeEvent)
  })

  test('falls back to in-memory key when NIP-07 absent', async () => {
    const result = await signAuthEvent()
    expect(result.kind).toBe(27235)
    expect(result.id).toMatch(/^[0-9a-f]{64}$/)
    expect(result.sig).toMatch(/^[0-9a-f]{128}$/)
  })
})

describe('signNip98AuthEvent', () => {
  test('event kind is 27235', async () => {
    const result = await signNip98AuthEvent('https://api.example.com/api/acoustic/signals', 'POST')
    expect(result.kind).toBe(27235)
  })

  test('u tag contains the provided URL', async () => {
    const url = 'https://api.example.com/api/acoustic/signals'
    const result = await signNip98AuthEvent(url, 'POST')
    const uTag = result.tags.find(t => t[0] === 'u')
    expect(uTag).toBeDefined()
    expect(uTag![1]).toBe(url)
  })

  test('method tag contains the provided HTTP method', async () => {
    const result = await signNip98AuthEvent('https://api.example.com/api/acoustic/signals', 'POST')
    const methodTag = result.tags.find(t => t[0] === 'method')
    expect(methodTag).toBeDefined()
    expect(methodTag![1]).toBe('POST')
  })

  test('uses NIP-07 when available', async () => {
    const fakeEvent = { id: 'abc', pubkey: 'xyz', created_at: 1, kind: 27235, tags: [['u', 'x'], ['method', 'POST']], content: '', sig: 'sig' }
    const signEvent = vi.fn().mockResolvedValue(fakeEvent)
    ;(window as unknown as Record<string, unknown>).nostr = { signEvent, getPublicKey: vi.fn() }
    const result = await signNip98AuthEvent('https://api.example.com/api/acoustic/signals', 'POST')
    expect(signEvent).toHaveBeenCalledOnce()
    expect(result).toBe(fakeEvent)
  })

  test('falls back to ephemeral key when NIP-07 absent', async () => {
    const result = await signNip98AuthEvent('https://api.example.com/api/acoustic/signals', 'POST')
    expect(result.id).toMatch(/^[0-9a-f]{64}$/)
    expect(result.sig).toMatch(/^[0-9a-f]{128}$/)
  })
})

describe('clearStoredKey', () => {
  test('removes sentinel_nostr_sk if present', () => {
    lsStore['sentinel_nostr_sk'] = 'deadbeef'
    clearStoredKey()
    expect(localStorageMock.getItem('sentinel_nostr_sk')).toBeNull()
  })
})

describe('signReport', () => {
  test('returns a Nostr event with id, pubkey, sig fields', async () => {
    const kp = await loadIdentity()
    const event = signReport(reportBindingContent('FLOODING', -1.29, 36.82, null), kp.secretKey)
    expect(event.id).toMatch(/^[0-9a-f]{64}$/)
    expect(event.sig).toMatch(/^[0-9a-f]{128}$/)
    expect(event.pubkey).toBe(kp.publicKey)
    expect(event.kind).toBe(30078)
  })

  test('event content is the canonical binding string', async () => {
    const kp = await loadIdentity()
    const content = reportBindingContent('FIRE', -1.29, 36.82, 'smoke')
    const event = signReport(content, kp.secretKey)
    expect(event.content).toBe(content)
  })
})

describe('binding content', () => {
  test('reportBindingContent uses fixed 6-decimal coordinates', () => {
    expect(reportBindingContent('FIRE', -1.2921, 36.8219, 'smoke')).toBe('r1|FIRE|-1.292100|36.821900|smoke')
    expect(reportBindingContent('FLOODING', 0, 0, null)).toBe('r1|FLOODING|0.000000|0.000000|')
  })

  test('voteBindingContent binds vote to report id', () => {
    expect(voteBindingContent('CONFIRM', 'abc-123')).toBe('v1|CONFIRM|abc-123')
  })
})

describe('vouch binding strings (must byte-match the gateway)', () => {
  it('vouchBindingContent is domain-separated', () => {
    expect(vouchBindingContent('abc')).toBe('sentinelmesh:vouch:v1:abc')
  })
  it('vouchRevokeBindingContent is domain-separated', () => {
    expect(vouchRevokeBindingContent('abc')).toBe('sentinelmesh:vouch-revoke:v1:abc')
  })
})
