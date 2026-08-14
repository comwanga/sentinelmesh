// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { parseChannelRef, loadChannelState } from '../publicChannel'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type { RelayClient, RelaySubscription } from '../../relay/relayClient'
import type { Event, Filter } from 'nostr-tools'

describe('publicChannel', () => {
  test('parses a raw group id', () => {
    expect(parseChannelRef('my-channel')).toEqual({ groupId: 'my-channel' })
  })

  test('rejects empty and oversized input', () => {
    expect(parseChannelRef('')).toBeNull()
    expect(parseChannelRef('x'.repeat(300))).toBeNull()
  })

  test('loads channel state from relay events', async () => {
    const relaySk = generateSecretKey()
    const relayPubkey = getPublicKey(relaySk)
    const now = Math.floor(Date.now() / 1000)
    const metadata = finalizeEvent(
      { kind: 39000, created_at: now, tags: [['d', 'group-1']], content: JSON.stringify({ name: 'Neighborhood Watch', about: 'Local' }) },
      relaySk,
    )
    const admins = finalizeEvent(
      { kind: 39001, created_at: now, tags: [['d', 'group-1'], ['p', 'a'.repeat(64)]], content: '' },
      relaySk,
    )
    const client: RelayClient = {
      async publish() { return [] },
      subscribe(_relays: string[], _filter: Filter, _onEvent: (event: Event) => void, _onEose: () => void): RelaySubscription { return { close() {} } },
      async query(_relays: string[], filter: Filter): Promise<Event[]> {
        if (filter.kinds?.[0] === 39000) return [metadata]
        if (filter.kinds?.[0] === 39001) return [admins]
        return []
      },
    }
    const state = await loadChannelState(client, 'wss://relay', 'group-1', relayPubkey)
    expect(state.name).toBe('Neighborhood Watch')
    expect(state.about).toBe('Local')
    expect(state.admins).toEqual(['a'.repeat(64)])
  })

  test('rejects state events not signed by the relay self key', async () => {
    const attacker = generateSecretKey()
    const now = Math.floor(Date.now() / 1000)
    const metadata = finalizeEvent(
      { kind: 39000, created_at: now, tags: [['d', 'group-1']], content: JSON.stringify({ name: 'Forged' }) },
      attacker,
    )
    const client: RelayClient = {
      async publish() { return [] },
      subscribe(): RelaySubscription { return { close() {} } },
      async query(): Promise<Event[]> { return [metadata] },
    }
    const state = await loadChannelState(client, 'wss://relay', 'group-1', 'f'.repeat(64))
    expect(state.name).toBe('group-1') // forged metadata ignored, default name kept
  })
})
