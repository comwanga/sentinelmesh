// Conversation identity. For NIP-17 rooms the identity is derived from the
// normalized, sorted, unique participant pubkeys so that the same set of people
// always map to the same room regardless of invite order. For public NIP-29
// channels the identity is the normalized relay URL plus group ID.
import { isLowercaseHex64 } from './eventValidation'

const VERSION_PREFIX = 'sentinelmesh:chat:v1'

/** Normalize a set of participant pubkeys (lowercase, unique, sorted). */
export function normalizeParticipants(pubkeys: string[]): string[] {
  return [...new Set(pubkeys.map(p => p.toLowerCase()).filter(isLowercaseHex64))].sort()
}

/** Stable participant-set key (deterministic, not hashed). */
export function participantKey(pubkeys: string[]): string {
  return `${VERSION_PREFIX}:${normalizeParticipants(pubkeys).join(',')}`
}

/** SHA-256 hex of the participant-set key — the durable conversation id. */
export async function conversationIdFor(pubkeys: string[]): Promise<string> {
  const material = new TextEncoder().encode(participantKey(pubkeys))
  const digest = await crypto.subtle.digest('SHA-256', material as unknown as BufferSource)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Public-channel conversation id (relay URL + group id are identity, not hash). */
export function channelConversationId(relayUrl: string, groupId: string): string {
  return `${VERSION_PREFIX}:channel:${relayUrl}:${groupId}`
}
