// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { finalizeEvent, generateSecretKey, type Event } from 'nostr-tools'
import { mergeUnique, resumeSince, fetchChannelHistory } from '../chatSync'
import type { RelayClient, RelaySubscription } from '../../relay/relayClient'

function channelMessage(id: number, created_at: number): Event {
  const sk = generateSecretKey()
  return finalizeEvent(
    { kind: 9, created_at, tags: [['h', 'group-1']], content: `hello ${id}` },
    sk,
  )
}

const NOW = Math.floor(Date.now() / 1000)

class FakeClient implements RelayClient {
  constructor(public events: Event[] = []) {}
  async publish() { return [] }
  subscribe(_relays: string[], _filter: unknown, _onEvent: (event: Event) => void, _onEose: () => void): RelaySubscription {
    return { close() {} }
  }
  async query(_relays: string[], _filter: unknown): Promise<Event[]> {
    return this.events
  }
}

describe('chatSync', () => {
  test('mergeUnique dedupes and sorts ascending', () => {
    const a = channelMessage(1, NOW)
    const b = channelMessage(2, NOW - 5)
    const merged = mergeUnique([a, b, a])
    expect(merged.map(m => m.content)).toEqual(['hello 2', 'hello 1'])
    expect(merged).toHaveLength(2)
  })

  test('resumeSince applies an overlap window', () => {
    expect(resumeSince(1000)).toBe(940)
    expect(resumeSince(30)).toBe(0)
  })

  test('fetchChannelHistory filters to valid group messages', async () => {
    const good = channelMessage(1, NOW - 10)
    const other = finalizeEvent({ kind: 9, created_at: NOW - 8, tags: [['h', 'other']], content: 'nope' }, generateSecretKey())
    const client = new FakeClient([other, good])
    const history = await fetchChannelHistory(client, 'wss://relay', 'group-1')
    expect(history.map(e => e.content)).toEqual(['hello 1'])
  })
})
