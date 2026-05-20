import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'

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
  loadOrCreateKeypair,
  signReport,
  getOrCreateEphemeralKeypair,
  hasNip07,
  signAuthEvent,
  signNip98AuthEvent,
  clearStoredKey,
} from '../services/nostrService'

describe('loadOrCreateKeypair', () => {
  test('returns a valid hex pubkey', () => {
    const kp = loadOrCreateKeypair()
    expect(kp.publicKey).toMatch(/^[0-9a-f]{64}$/)
  })

  test('does NOT persist raw key to localStorage', () => {
    loadOrCreateKeypair()
    expect(localStorageMock.getItem('sentinel_nostr_sk')).toBeNull()
  })

  test('returns the same in-memory keypair on subsequent calls', () => {
    const kp1 = loadOrCreateKeypair()
    const kp2 = loadOrCreateKeypair()
    expect(kp1.publicKey).toBe(kp2.publicKey)
  })
})

describe('getOrCreateEphemeralKeypair', () => {
  test('consistent across calls within the same module lifetime', () => {
    const k1 = getOrCreateEphemeralKeypair()
    const k2 = getOrCreateEphemeralKeypair()
    expect(k1.publicKey).toBe(k2.publicKey)
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
  test('returns a Nostr event with id, pubkey, sig fields', () => {
    const kp = loadOrCreateKeypair()
    const event = signReport({ report_type: 'FLOODING', lat: -1.29, lng: 36.82 }, kp.secretKey)
    expect(event.id).toMatch(/^[0-9a-f]{64}$/)
    expect(event.sig).toMatch(/^[0-9a-f]{128}$/)
    expect(event.pubkey).toBe(kp.publicKey)
    expect(event.kind).toBe(30078)
  })

  test('event content encodes the payload as JSON', () => {
    const kp = loadOrCreateKeypair()
    const event = signReport({ report_type: 'FIRE' }, kp.secretKey)
    const content = JSON.parse(event.content)
    expect(content.report_type).toBe('FIRE')
  })
})
