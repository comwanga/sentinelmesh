// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import {
  isLowercaseHex64,
  singleTag,
  withinEventBounds,
  validMessageContent,
  eventSizeBytes,
} from '../eventValidation'

function signedEvent(kind: number, tags: string[][], content = 'hello') {
  const sk = generateSecretKey()
  return finalizeEvent({ kind, created_at: Math.floor(Date.now() / 1000), tags, content }, sk)
}

describe('eventValidation', () => {
  test('isLowercaseHex64 accepts only 64-char lowercase hex', () => {
    expect(isLowercaseHex64('a'.repeat(64))).toBe(true)
    expect(isLowercaseHex64('A'.repeat(64))).toBe(false)
    expect(isLowercaseHex64('a'.repeat(63))).toBe(false)
    expect(isLowercaseHex64('g'.repeat(64))).toBe(false)
  })

  test('singleTag rejects duplicates', () => {
    const e = signedEvent(1, [['p', 'a'.repeat(64)], ['p', 'b'.repeat(64)]])
    expect(singleTag(e, 'p')).toBeNull()
    const single = signedEvent(1, [['p', 'a'.repeat(64)]])
    expect(singleTag(single, 'p')).toBe('a'.repeat(64))
  })

  test('withinEventBounds rejects oversized events and bad pubkeys', () => {
    const e = signedEvent(1, [], 'x'.repeat(200_000))
    expect(withinEventBounds(e)).toBe(false)
    const ok = signedEvent(1, [], 'hi')
    expect(withinEventBounds(ok)).toBe(true)
  })

  test('validMessageContent bounds text', () => {
    expect(validMessageContent('hi')).toBe(true)
    expect(validMessageContent('')).toBe(false)
    expect(validMessageContent('x'.repeat(20_000))).toBe(false)
  })

  test('eventSizeBytes is non-negative and grows with content', () => {
    const a = signedEvent(1, [], 'a')
    const b = signedEvent(1, [], 'a'.repeat(100))
    expect(eventSizeBytes(a)).toBeGreaterThan(0)
    expect(eventSizeBytes(b)).toBeGreaterThan(eventSizeBytes(a))
  })
})
