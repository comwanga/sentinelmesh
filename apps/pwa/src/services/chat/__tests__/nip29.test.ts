// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { createChannelMessage, validateChannelMessage, validateGroupStateEvent, buildManagementTemplate, deleteMessageTemplate, removeUserTemplate } from '../nip29'

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

  test('builds management templates bound to the group', () => {
    const del = deleteMessageTemplate('group-1', 'e'.repeat(64))
    expect(del.kind).toBe(9005)
    expect(del.tags).toContainEqual(['h', 'group-1'])
    expect(del.tags).toContainEqual(['e', 'e'.repeat(64)])

    const remove = removeUserTemplate('group-1', 'A'.repeat(64))
    expect(remove.kind).toBe(9001)
    expect(remove.tags).toContainEqual(['p', 'a'.repeat(64)])

    const meta = buildManagementTemplate(9002, 'group-1', [], '{"name":"x"}')
    expect(meta.kind).toBe(9002)
    expect(meta.content).toBe('{"name":"x"}')
  })
})
