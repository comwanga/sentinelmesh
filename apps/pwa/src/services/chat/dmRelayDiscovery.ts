// Recipient DM relay discovery (kind 10050). Falls back to the managed inbox
// relay when a recipient has published no relay list; never sends when neither
// a list nor a fallback exists.
import type { Event } from 'nostr-tools'
import type { RelayClient } from '../relay/relayClient'
import { parseRelayUrls, DM_RELAY_LIST_KIND } from '../relay/relayDiscovery'

export async function resolveRecipientRelays(
  client: RelayClient,
  recipientPubkey: string,
  discoveryRelays: string[],
  fallbackRelay?: string,
): Promise<string[]> {
  if (discoveryRelays.length === 0) return fallbackRelay ? [fallbackRelay] : []
  let events: Event[] = []
  try {
    events = await client.query(discoveryRelays, {
      kinds: [DM_RELAY_LIST_KIND],
      authors: [recipientPubkey.toLowerCase()],
      limit: 1,
    })
  } catch {
    events = []
  }
  const latest = events[0]
  if (!latest) return fallbackRelay ? [fallbackRelay] : []
  const relays = parseRelayUrls(latest)
  return relays.length > 0 ? relays : fallbackRelay ? [fallbackRelay] : []
}
