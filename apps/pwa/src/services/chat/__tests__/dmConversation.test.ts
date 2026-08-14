// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { directConversationId, roomConversationId, peerParticipants } from '../dmConversation'

describe('dmConversation', () => {
  test('direct conversation id is order-independent', async () => {
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    expect(await directConversationId(a, b)).toBe(await directConversationId(b, a))
  })

  test('room conversation id differs per participant set', async () => {
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    const c = 'c'.repeat(64)
    expect(await roomConversationId([a, b])).not.toBe(await roomConversationId([a, b, c]))
  })

  test('peerParticipants excludes the local pubkey and normalizes', () => {
    const mine = 'a'.repeat(64)
    const others = ['B'.repeat(64), mine, 'c'.repeat(64)]
    expect(peerParticipants(mine, others)).toEqual(['b'.repeat(64), 'c'.repeat(64)])
  })
})
