// Chat relay configuration. Public build-time values only — never embed secrets.
// Defaults are empty so chat stays dark until a relay operator explicitly wires
// endpoint(s) at build time.

function csv(value: string | undefined): string[] {
  return (value ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

export const chatRelays = Object.freeze({
  /** Managed inbox relay for NIP-17 gift wraps (kind 1059). */
  inbox: import.meta.env.VITE_CHAT_INBOX_RELAY_URL as string | undefined,
  /** Public NIP-29 community relay. */
  community: import.meta.env.VITE_CHAT_COMMUNITY_RELAY_URL as string | undefined,
  /** Configured discovery relays for relay lists (10002/10050/10009). */
  discovery: csv(import.meta.env.VITE_CHAT_DISCOVERY_RELAYS as string | undefined),
})

export const hasChatRelays = (): boolean => Boolean(chatRelays.inbox || chatRelays.community)
