// Public-channel sync: live subscription plus bounded historical query with
// event-id deduplication. Timestamps are the ordering key; a small overlap is
// re-queried on reconnect so out-of-order delivery does not lose messages.
import type { Event, Filter } from 'nostr-tools'
import type { RelayClient } from '../relay/relayClient'
import { NIP29_KIND_MESSAGE, validateChannelMessage } from './nip29'

export const CHANNEL_HISTORY_LIMIT = 200
export const CHANNEL_SYNC_OVERLAP_SECONDS = 60

export interface ChannelSyncHandle {
  close(): void
}

/** Subscribe live to a channel's kind-9 messages, deduplicating by event id. */
export function subscribeChannel(
  client: RelayClient,
  relayUrl: string,
  groupId: string,
  opts: { onEvent: (event: Event) => void; onEose?: () => void; since?: number; seen?: Set<string> },
): ChannelSyncHandle {
  const seen = opts.seen ?? new Set<string>()
  const filter: Filter = { kinds: [NIP29_KIND_MESSAGE], '#h': [groupId] }
  if (opts.since) filter.since = opts.since

  const sub = client.subscribe([relayUrl], filter, (event) => {
    if (!validateChannelMessage(event, groupId)) return
    if (seen.has(event.id)) return
    seen.add(event.id)
    opts.onEvent(event)
  }, () => opts.onEose?.())

  return { close: () => sub.close() }
}

/** Bounded historical query, validated and sorted ascending by created_at. */
export async function fetchChannelHistory(
  client: RelayClient,
  relayUrl: string,
  groupId: string,
  opts: { since?: number; until?: number; limit?: number } = {},
): Promise<Event[]> {
  const filter: Filter = { kinds: [NIP29_KIND_MESSAGE], '#h': [groupId], limit: opts.limit ?? CHANNEL_HISTORY_LIMIT }
  if (opts.since) filter.since = opts.since
  if (opts.until) filter.until = opts.until
  const events = await client.query([relayUrl], filter)
  return mergeUnique(events.filter(e => validateChannelMessage(e, groupId)))
}

/** Deduplicate by event id and sort ascending by created_at. */
export function mergeUnique(events: Event[]): Event[] {
  const byId = new Map<string, Event>()
  for (const event of events) byId.set(event.id, event)
  return [...byId.values()].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1))
}

/** Resume cursor with a small overlap so late/out-of-order messages are re-seen. */
export function resumeSince(lastCreatedAt: number): number {
  return Math.max(0, lastCreatedAt - CHANNEL_SYNC_OVERLAP_SECONDS)
}
