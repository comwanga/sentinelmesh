import { describe, test, expect } from 'vitest'
import { generateSecretKey, finalizeEvent } from 'nostr-tools'
import { verifyNostrSignature } from '../src/nostr/verifier'

function makeEvent(sk: Uint8Array, content = 'test') {
  return finalizeEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', 'sentinel-report']],
    content,
  }, sk)
}

describe('verifyNostrSignature', () => {
  test('returns true for a valid Nostr event', () => {
    const sk = generateSecretKey()
    const event = makeEvent(sk)
    expect(verifyNostrSignature(event)).toBe(true)
  })

  test('returns false for a tampered event content', () => {
    const sk = generateSecretKey()
    const event = makeEvent(sk, 'original')
    expect(verifyNostrSignature({ ...event, content: 'tampered' })).toBe(false)
  })

  test('returns false when sig is wrong', () => {
    const sk = generateSecretKey()
    const event = makeEvent(sk)
    const wrongSig = 'a'.repeat(128)
    expect(verifyNostrSignature({ ...event, sig: wrongSig })).toBe(false)
  })
})
