// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import {
  blockPubkey,
  unblockPubkey,
  mutePubkey,
  isBlocked,
  isMuted,
  quarantineDecision,
} from '../moderation'

describe('moderation', () => {
  test('blocks and unblocks a pubkey', async () => {
    await blockPubkey('A'.repeat(64))
    expect(await isBlocked('a'.repeat(64))).toBe(true)
    await unblockPubkey('a'.repeat(64))
    expect(await isBlocked('a'.repeat(64))).toBe(false)
  })

  test('mutes a pubkey independently of blocking', async () => {
    await mutePubkey('b'.repeat(64))
    expect(await isMuted('b'.repeat(64))).toBe(true)
    expect(await isBlocked('b'.repeat(64))).toBe(false)
  })

  test('quarantine decision: block > contact/circle > quarantine', () => {
    expect(quarantineDecision('p', { isContact: false, isCircleMember: false, isBlocked: true })).toBe('block')
    expect(quarantineDecision('p', { isContact: true, isCircleMember: false, isBlocked: false })).toBe('accept')
    expect(quarantineDecision('p', { isContact: false, isCircleMember: true, isBlocked: false })).toBe('accept')
    expect(quarantineDecision('p', { isContact: false, isCircleMember: false, isBlocked: false })).toBe('quarantine')
  })
})
