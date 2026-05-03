import { vi, describe, test, expect, beforeEach } from 'vitest'

const store: Record<string, string> = {}
// vi.stubGlobal runs at module-eval time. nostrService accesses localStorage
// only inside functions (never at module scope), so the static import above
// resolves safely before the stub is needed.
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
  clear: () => { Object.keys(store).forEach(k => delete store[k]) },
})

beforeEach(() => localStorage.clear())

import { loadOrCreateKeypair, signReport } from '../services/nostrService'

describe('loadOrCreateKeypair', () => {
  test('generates and persists a keypair on first call', () => {
    const kp = loadOrCreateKeypair()
    expect(kp.publicKey).toMatch(/^[0-9a-f]{64}$/)
    expect(localStorage.getItem('sentinel_nostr_sk')).not.toBeNull()
  })

  test('returns the same keypair on subsequent calls', () => {
    const kp1 = loadOrCreateKeypair()
    const kp2 = loadOrCreateKeypair()
    expect(kp1.publicKey).toBe(kp2.publicKey)
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
