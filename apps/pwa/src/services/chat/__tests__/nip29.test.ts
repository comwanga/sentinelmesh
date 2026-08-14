// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { createChannelMessage, validateChannelMessage, validateGroupStateEvent } from '../nip29'

describe('nip29', () => {
  test('builds a kind-9 message with exactly one h tag', () => {
    const msg = createChannelMessage('a'.repeat(64), 'group-1', 'hello channel')
    expect(msg.template.kind).toBe(9)
    expect(msg.template.tags).toEqual([['h', 'group-1']])
    expect(msg.groupId).toBe('group-1')
  })

  test('validates a correctly signed channel message', () => {
    const sk = generateSecretKey()
    const event = finalizeEvent(
      { kind: 9, created_at: Math.floor(Date.now() / 1000), tags: [['h', 'group-1']], content: 'hi' },
      sk,
    )
    expect(validateChannelMessage(event, 'group-1')).toBe(true)
    expect(validateChannelMessage(event, 'other-group')).toBe(false)
  })

  test('rejects channel message with duplicate h tags', () => {
    const sk = generateSecretKey()
    const event = finalizeEvent(
      { kind: 9, created_at: Math.floor(Date.now() / 1000), tags: [['h', 'g'], ['h', 'g']], content: 'hi' },
      sk,
    )
    expect(validateChannelMessage(event, 'g')).toBe(false)
  })

  test('validates group state only when signed by the relay self key', () => {
    const relaySk = generateSecretKey()
    const relayPubkey = getPublicKey(relaySk)
    const event = finalizeEvent(
      { kind: 39000, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'group-1']], content: '{}' },
      relaySk,
    )
    expect(validateGroupStateEvent(event, 'group-1', relayPubkey)).toBe(true)
    expect(validateGroupStateEvent(event, 'group-1', 'f'.repeat(64))).toBe(false)
  })
})
