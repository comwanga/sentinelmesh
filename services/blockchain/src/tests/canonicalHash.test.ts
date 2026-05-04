import { buildAnchorHash } from '../utils/canonicalHash'

describe('buildAnchorHash', () => {
  const params = {
    event_id: 'abc123',
    nostr_event_id: 'def456',
    severity: 'CRITICAL',
  }

  it('returns a 64-char lowercase hex string', () => {
    const hash = buildAnchorHash(params)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic — same inputs always produce the same hash', () => {
    expect(buildAnchorHash(params)).toBe(buildAnchorHash(params))
  })

  it('is sensitive to each field', () => {
    const h1 = buildAnchorHash(params)
    const h2 = buildAnchorHash({ ...params, event_id: 'different' })
    const h3 = buildAnchorHash({ ...params, nostr_event_id: 'different' })
    const h4 = buildAnchorHash({ ...params, severity: 'AUTHORITATIVE' })
    expect(new Set([h1, h2, h3, h4]).size).toBe(4)
  })

  it('is key-order independent — same hash regardless of object property order', () => {
    const h1 = buildAnchorHash({ event_id: 'a', nostr_event_id: 'b', severity: 'CRITICAL' })
    const h2 = buildAnchorHash({ severity: 'CRITICAL', nostr_event_id: 'b', event_id: 'a' })
    expect(h1).toBe(h2)
  })
})
