// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import type { Event, Filter } from 'nostr-tools'
import type { RelayClient, RelaySubscription } from '../../relay/relayClient'
import { resolveRecipientRelays } from '../dmRelayDiscovery'

class FakeClient implements RelayClient {
  constructor(public events: Event[] = []) {}
  async publish() { return [] }
  subscribe(): RelaySubscription { return { close() {} } }
  async query(_relays: string[], _filter: Filter): Promise<Event[]> { return this.events }
}

function relayList(pubkey: string, relays: string[]): Event {
  const sk = generateSecretKey()
  return finalizeEvent({ kind: 10050, created_at: Math.floor(Date.now() / 1000), tags: relays.map(r => ['r', r]), content: '' }, sk)
}

describe('dmRelayDiscovery', () => {
  test('resolves a published kind-10050 relay list', async () => {
    const client = new FakeClient([relayList('a'.repeat(64), ['wss://inbox-a', 'wss://inbox-b'])])
    const relays = await resolveRecipientRelays(client, 'a'.repeat(64), ['wss://discovery'])
    expect(relays).toEqual(['wss://inbox-a', 'wss://inbox-b'])
  })

  test('falls back to the managed inbox when no list is published', async () => {
    const client = new FakeClient([])
    const relays = await resolveRecipientRelays(client, 'a'.repeat(64), ['wss://discovery'], 'wss://fallback')
    expect(relays).toEqual(['wss://fallback'])
  })

  test('returns empty when no list and no fallback', async () => {
    const client = new FakeClient([])
    expect(await resolveRecipientRelays(client, 'a'.repeat(64), ['wss://discovery'])).toEqual([])
  })
})
