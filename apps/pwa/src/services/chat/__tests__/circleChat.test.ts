// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { circleChatParticipants, circleChatFeasible } from '../circleChat'

describe('circleChat', () => {
  test('derives active member participants excluding the owner and pending', () => {
    const owner = 'a'.repeat(64)
    const members = [
      { pubkey: 'b'.repeat(64), membership_state: 'ACTIVE' as const },
      { pubkey: 'c'.repeat(64), membership_state: 'PENDING' as const },
      { pubkey: owner },
    ]
    const participants = circleChatParticipants(owner, members)
    expect(participants).toEqual([owner, 'b'.repeat(64)])
  })

  test('feasibility requires 2..10 participants', () => {
    expect(circleChatFeasible(['a'.repeat(64)])).toBe(false)
    expect(circleChatFeasible(['a'.repeat(64), 'b'.repeat(64)])).toBe(true)
    expect(circleChatFeasible(Array.from({ length: 11 }, (_, i) => String(i).repeat(64)))).toBe(false)
  })
})
