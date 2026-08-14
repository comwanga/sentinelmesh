// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { normalizeRelayUrl, assertSecureRelayUrl, relaySupportsNips, fetchRelayInfo } from '../relayConnection'

describe('relayConnection', () => {
  test('normalizes trailing slash', () => {
    expect(normalizeRelayUrl('wss://relay.example.com/')).toBe('wss://relay.example.com')
  })

  test('rejects a relay URL with a path', () => {
    expect(() => normalizeRelayUrl('wss://relay.example.com/path')).toThrow('path')
  })

  test('rejects credentials', () => {
    expect(() => normalizeRelayUrl('wss://user:pass@relay.example.com')).toThrow('credentials')
  })

  test('assertSecureRelayUrl enforces wss outside development', () => {
    expect(() => assertSecureRelayUrl('ws://relay.example.com')).toThrow('wss')
    expect(() => assertSecureRelayUrl('ws://relay.example.com', true)).not.toThrow()
    expect(() => assertSecureRelayUrl('wss://relay.example.com')).not.toThrow()
    expect(() => assertSecureRelayUrl('https://relay.example.com')).toThrow('ws://')
  })

  test('relaySupportsNips requires every NIP', () => {
    expect(relaySupportsNips({ supported_nips: [1, 11, 42] }, [11, 42])).toBe(true)
    expect(relaySupportsNips({ supported_nips: [1, 11] }, [11, 42])).toBe(false)
    expect(relaySupportsNips(null, [11])).toBe(false)
  })

  test('fetchRelayInfo requests the NIP-11 document over https', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ name: 'relay', supported_nips: [11, 42] }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch
    const info = await fetchRelayInfo('wss://relay.example.com', fetchImpl)
    expect(info.name).toBe('relay')
    expect(info.supported_nips).toContain(42)
  })
})
