// Shared event validation primitives. Applied BEFORE any expensive decryption or
// render, so malformed or oversized input cannot be used as a DoS vector.
import { verifyEvent } from 'nostr-tools'
import type { Event } from 'nostr-tools'

export const MAX_EVENT_BYTES = 100_000
export const MAX_MESSAGE_BYTES = 16_384
export const MAX_CREATED_AT_SKEW_SECONDS = 2 * 24 * 60 * 60
export const MAX_TAGS = 256
export const MAX_ROOM_PARTICIPANTS = 10

/** True when `value` is a 64-char lowercase hex Nostr pubkey/event id. */
export function isLowercaseHex64(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}

/** Approximate serialized byte size of an event. */
export function eventSizeBytes(event: Event): number {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]).length
}

/** Reject events that are oversized, malformed, or outside the timestamp window. */
export function withinEventBounds(
  event: Event,
  now = Math.floor(Date.now() / 1000),
  opts: { maxBytes?: number; maxSkew?: number } = {},
): boolean {
  if (eventSizeBytes(event) > (opts.maxBytes ?? MAX_EVENT_BYTES)) return false
  if (event.tags.length > MAX_TAGS) return false
  if (!isLowercaseHex64(event.pubkey)) return false
  const skew = Math.abs(now - event.created_at)
  if (skew > (opts.maxSkew ?? MAX_CREATED_AT_SKEW_SECONDS)) return false
  return true
}

/** Return the single value of tag `name`, or null when absent or duplicated. */
export function singleTag(event: Event, name: string): string | null {
  let found: string | null = null
  for (const tag of event.tags) {
    if (tag[0] === name) {
      if (found !== null) return null
      found = tag[1] ?? null
    }
  }
  return found
}

/** Verify the event's NIP-01 signature and id. */
export function isSignatureValid(event: Event): boolean {
  try {
    return verifyEvent(event)
  } catch {
    return false
  }
}

/** True when content is plain text within the message size bound. */
export function validMessageContent(content: string): boolean {
  return typeof content === 'string' && content.length > 0 && content.length <= MAX_MESSAGE_BYTES
}
