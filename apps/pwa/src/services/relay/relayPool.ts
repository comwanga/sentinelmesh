// Relay pool wrapper: a thin, ownership-clear layer over nostr-tools'
// AbstractSimplePool with NIP-42 auto-auth wired to the active signer. Protocol
// validation, cursors, and authentication policy remain SentinelMesh-controlled.
import { verifyEvent } from 'nostr-tools'
import { AbstractSimplePool, type SubCloser } from 'nostr-tools/abstract-pool'
import type { Event, Filter } from 'nostr-tools'
import type { NostrSigner } from '../signerService'
import { automaticAuth } from './relayAuth'

export interface RelayPoolOptions {
  signer: NostrSigner
  enablePing?: boolean
  enableReconnect?: boolean
  maxWaitForConnection?: number
}

export class RelayPool {
  readonly pool: AbstractSimplePool

  constructor(private readonly options: RelayPoolOptions) {
    this.pool = new AbstractSimplePool({
      verifyEvent,
      enablePing: options.enablePing ?? true,
      enableReconnect: options.enableReconnect ?? true,
      maxWaitForConnection: options.maxWaitForConnection ?? 5000,
      automaticallyAuth: automaticAuth(options.signer),
    })
  }

  /** Publish an event to the given relays and return per-relay results. */
  async publish(relays: string[], event: Event): Promise<{ url: string; ok: boolean; message?: string }[]> {
    const results = await Promise.all(this.pool.publish(relays, event, { maxWait: 8000 }))
    return relays.map((url, i) => {
      const message = results[i]
      return { url, ok: message === 'success' || message === 'duplicate', message }
    })
  }

  subscribe(relays: string[], filter: Filter, params: {
    onevent: (event: Event) => void
    oneose?: () => void
    onclose?: (reasons: string[]) => void
  }): SubCloser {
    return this.pool.subscribeEose(relays, filter, params)
  }

  querySync(relays: string[], filter: Filter): Promise<Event[]> {
    return this.pool.querySync(relays, filter, { maxWait: 8000 })
  }

  destroy(): void {
    this.pool.destroy()
  }
}
