// NIP-29 public channel operations: load relay state (metadata/admins/members),
// publish a signed channel message, and parse a channel reference (raw group id
// or NIP-19 naddr).
import { nip19 } from 'nostr-tools'
import type { Event } from 'nostr-tools'
import type { RelayClient } from '../relay/relayClient'
import { NIP29_KIND_METADATA, NIP29_KIND_ADMINS, NIP29_KIND_MEMBERS, validateGroupStateEvent } from './nip29'

export interface ChannelState {
  relayUrl: string
  groupId: string
  name: string
  about: string
  admins: string[]
  members: string[]
}

export interface ParsedChannelRef {
  groupId: string
  relayUrl?: string
}

/** Parse a channel reference: a NIP-19 `naddr` or a raw group id. */
export function parseChannelRef(input: string): ParsedChannelRef | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('naddr1')) {
    try {
      const decoded = nip19.decode(trimmed)
      if (decoded.type !== 'naddr') return null
      const data = decoded.data as { identifier?: string; relays?: string[] }
      if (!data.identifier) return null
      return { groupId: data.identifier, relayUrl: data.relays?.[0] }
    } catch {
      return null
    }
  }
  if (trimmed.length > 256) return null
  return { groupId: trimmed }
}

async function fetchState(
  client: RelayClient,
  relayUrl: string,
  groupId: string,
  kind: number,
  relaySelfPubkey: string | null,
): Promise<Event[]> {
  const events = await client.query([relayUrl], { kinds: [kind], '#d': [groupId], limit: 50 })
  return events.filter(e => validateGroupStateEvent(e, groupId, relaySelfPubkey))
}

/** Load a channel's relay state (metadata + admins + members). */
export async function loadChannelState(
  client: RelayClient,
  relayUrl: string,
  groupId: string,
  relaySelfPubkey: string | null = null,
): Promise<ChannelState> {
  const [metadata, admins, members] = await Promise.all([
    fetchState(client, relayUrl, groupId, NIP29_KIND_METADATA, relaySelfPubkey),
    fetchState(client, relayUrl, groupId, NIP29_KIND_ADMINS, relaySelfPubkey),
    fetchState(client, relayUrl, groupId, NIP29_KIND_MEMBERS, relaySelfPubkey),
  ])
  let name = groupId.slice(0, 12)
  let about = ''
  try {
    const meta = JSON.parse(metadata[0]?.content ?? '{}') as { name?: string; about?: string }
    if (meta.name) name = meta.name
    if (meta.about) about = meta.about
  } catch {
    // keep default name
  }
  const tagPubkeys = (events: Event[]): string[] => {
    const keys = new Set<string>()
    for (const e of events) for (const t of e.tags) if (t[0] === 'p' && t[1]) keys.add(t[1])
    return [...keys]
  }
  return { relayUrl, groupId, name, about, admins: tagPubkeys(admins), members: tagPubkeys(members) }
}

/** Publish a signed channel message and return per-relay results. */
export async function publishChannelMessage(
  client: RelayClient,
  relayUrl: string,
  event: Event,
): Promise<{ url: string; ok: boolean; message?: string }[]> {
  return client.publish([relayUrl], event)
}
