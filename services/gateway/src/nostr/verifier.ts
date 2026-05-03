import { verifyEvent } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'

export type { NostrEvent }

export function verifyNostrSignature(event: NostrEvent): boolean {
  if (!event || typeof event !== 'object') return false
  try {
    // Strip the nostr-tools verifiedSymbol if the caller passes back the
    // same object reference that verifyEvent previously stamped. A spread
    // does not copy symbols, but a round-trip through JSON does strip them.
    const freshEvent = JSON.parse(JSON.stringify(event))
    return verifyEvent(freshEvent as Parameters<typeof verifyEvent>[0])
  } catch {
    return false
  }
}
