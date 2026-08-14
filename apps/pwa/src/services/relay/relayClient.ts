// Relay client abstraction: chat sync/UI code talks to this interface so the
// real pool can be swapped for a fake in tests. Protocol validation, dedup, and
// cursors remain above this boundary.
import type { Event, Filter } from 'nostr-tools'
import type { RelayPool } from './relayPool'

export interface RelaySubscription {
  close(): void
}

export interface RelayClient {
  publish(relays: string[], event: Event): Promise<{ url: string; ok: boolean; message?: string }[]>
  subscribe(relays: string[], filter: Filter, onEvent: (event: Event) => void, onEose: () => void): RelaySubscription
  query(relays: string[], filter: Filter): Promise<Event[]>
}

/** Adapt the concrete RelayPool to the RelayClient interface. */
export class RelayPoolAdapter implements RelayClient {
  constructor(private readonly pool: RelayPool) {}

  async publish(relays: string[], event: Event): Promise<{ url: string; ok: boolean; message?: string }[]> {
    return this.pool.publish(relays, event)
  }

  subscribe(relays: string[], filter: Filter, onEvent: (event: Event) => void, onEose: () => void): RelaySubscription {
    return this.pool.subscribe(relays, filter, { onevent: onEvent, oneose: onEose })
  }

  query(relays: string[], filter: Filter): Promise<Event[]> {
    return this.pool.querySync(relays, filter)
  }
}
