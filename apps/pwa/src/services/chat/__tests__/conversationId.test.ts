// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { conversationIdFor, normalizeParticipants, participantKey, channelConversationId } from '../conversationId'

describe('conversationId', () => {
  test('normalizes participants to lowercase, unique, sorted', () => {
    const out = normalizeParticipants(['B'.repeat(64), 'a'.repeat(64), 'A'.repeat(64), 'c'.repeat(64)])
    expect(out).toEqual(['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)])
  })

  test('drops invalid pubkeys', () => {
    expect(normalizeParticipants(['nope', 'a'.repeat(64)])).toEqual(['a'.repeat(64)])
  })

  test('participant order does not change the conversation id', async () => {
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    const id1 = await conversationIdFor([a, b])
    const id2 = await conversationIdFor([b, a])
    expect(id1).toBe(id2)
    expect(id1).toMatch(/^[0-9a-f]{64}$/)
  })

  test('different participant sets produce different ids', async () => {
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    const c = 'c'.repeat(64)
    expect(await conversationIdFor([a, b])).not.toBe(await conversationIdFor([a, c]))
  })

  test('participantKey is deterministic and versioned', () => {
    const a = 'a'.repeat(64)
    expect(participantKey([a])).toBe(participantKey([a]))
    expect(participantKey([a])).toContain('sentinelmesh:chat:v1')
  })

  test('channelConversationId embeds relay and group', () => {
    const id = channelConversationId('wss://relay.example.com', 'group-1')
    expect(id).toContain('wss://relay.example.com')
    expect(id).toContain('group-1')
  })
})
