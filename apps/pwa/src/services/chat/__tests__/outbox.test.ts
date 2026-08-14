// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import type { Event, Filter } from 'nostr-tools'
import type { RelayClient, RelaySubscription } from '../../relay/relayClient'
import { enqueueOutbox, deliverPendingOutbox } from '../outbox'

class FakeClient implements RelayClient {
  constructor(public ok: boolean = true) {}
  async publish(_relays: string[], _event: Event) {
    return [{ url: 'wss://relay', ok: this.ok }]
  }
  subscribe(): RelaySubscription { return { close() {} } }
  async query(): Promise<Event[]> { return [] }
}

function wrapEvent(id: number): Event {
  return finalizeEvent({ kind: 1059, created_at: Math.floor(Date.now() / 1000), tags: [['p', 'b'.repeat(64)]], content: 'x' }, generateSecretKey())
}

describe('outbox', () => {
  test('delivers a pending wrap and marks it delivered', async () => {
    const wrap = wrapEvent(1)
    await enqueueOutbox('b'.repeat(64), ['wss://relay'], wrap)
    const result = await deliverPendingOutbox(new FakeClient(true))
    expect(result).toEqual({ delivered: 1, failed: 0 })
    // Second pass: nothing pending.
    expect(await deliverPendingOutbox(new FakeClient(true))).toEqual({ delivered: 0, failed: 0 })
  })

  test('retries a failed publish with backoff', async () => {
    const wrap = wrapEvent(2)
    await enqueueOutbox('b'.repeat(64), ['wss://relay'], wrap)
    const result = await deliverPendingOutbox(new FakeClient(false), 0)
    expect(result).toEqual({ delivered: 0, failed: 1 })
  })
})
