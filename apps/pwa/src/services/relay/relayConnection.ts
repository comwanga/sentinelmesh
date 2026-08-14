// Relay URL normalization and NIP-11 relay information document conformance.
// The app must never trust a relay's self-description for signature validation;
// this only gates which relays we are willing to connect to and which NIPs we
// assume they implement.

export const NIP11_ACCEPT_HEADER = 'application/nostr+json'

export interface RelayInfoDocument {
  name?: string
  description?: string
  pubkey?: string
  contact?: string
  supported_nips?: number[]
  software?: string
  version?: string
  limitation?: { max_message_length?: number; max_subscriptions?: number }
}

/** Normalize a relay URL to a canonical `wss://host` (or `ws://` in dev) form. */
export function normalizeRelayUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  const parsed = new URL(trimmed)
  if (parsed.pathname && parsed.pathname !== '/') {
    throw new Error(`relay URL must not include a path: ${url}`)
  }
  if (parsed.username || parsed.password) {
    throw new Error(`relay URL must not include credentials: ${url}`)
  }
  return parsed.toString().replace(/\/$/, '')
}

/** Enforce `wss://` outside development (browser relays must be TLS). */
export function assertSecureRelayUrl(url: string, allowInsecure = false): void {
  const normalized = normalizeRelayUrl(url)
  if (normalized.startsWith('ws://') && !allowInsecure) {
    throw new Error(`relay URL must use wss:// outside development: ${url}`)
  }
  if (!normalized.startsWith('ws://') && !normalized.startsWith('wss://')) {
    throw new Error(`relay URL must use ws:// or wss://: ${url}`)
  }
}

/** Fetch and parse a NIP-11 relay information document (https://host). */
export async function fetchRelayInfo(url: string, fetchImpl: typeof fetch = fetch): Promise<RelayInfoDocument> {
  const normalized = normalizeRelayUrl(url)
  const httpsUrl = normalized.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
  const response = await fetchImpl(httpsUrl, {
    headers: { Accept: NIP11_ACCEPT_HEADER },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`relay information request failed (${response.status})`)
  return (await response.json()) as RelayInfoDocument
}

/** True when a relay advertises every required NIP (absent NIP-11 → false). */
export function relaySupportsNips(info: RelayInfoDocument | null, required: number[]): boolean {
  if (!info?.supported_nips) return false
  return required.every(nip => info.supported_nips!.includes(nip))
}
