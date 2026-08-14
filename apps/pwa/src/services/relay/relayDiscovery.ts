// Relay discovery: parsing of the standard relay-list event kinds. Pure parsing
// only — network resolution is left to the relay transport.
import type { Event } from 'nostr-tools'

export const RELAY_LIST_KIND = 10002
export const DM_RELAY_LIST_KIND = 10050
export const GROUP_LIST_KIND = 10009

/** Extract relay URLs from a relay-list event's `r` tags (kind 10002/10050). */
export function parseRelayUrls(event: Event): string[] {
  const urls: string[] = []
  for (const tag of event.tags) {
    if (tag[0] === 'r' && tag[1]) urls.push(tag[1])
  }
  return urls
}

/** Extract remembered NIP-29 group references from a kind-10009 event. */
export function parseGroupList(event: Event): { relayUrl: string; groupId: string }[] {
  const groups: { relayUrl: string; groupId: string }[] = []
  for (const tag of event.tags) {
    if (tag[0] === 'g' && tag[1]) {
      const id = tag[1]
      const relayUrl = tag[2] ?? ''
      if (relayUrl) groups.push({ relayUrl, groupId: id })
    }
  }
  return groups
}
