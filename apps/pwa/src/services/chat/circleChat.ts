// Family Circle chat: derive the NIP-17 room participant set from the Circle
// roster. Chat uses pairwise NIP-17 encryption (NOT the shared Circle AES key);
// a roster change produces a new participant set and therefore a new room.
import { normalizeParticipants } from './conversationId'

export interface CircleChatMember {
  pubkey: string
  membership_state?: 'PENDING' | 'ACTIVE'
}

export const MAX_CIRCLE_CHAT_PARTICIPANTS = 10

/** Active Circle members (excluding the owner) eligible for the chat room. */
export function circleChatParticipants(ownerPubkey: string, members: CircleChatMember[]): string[] {
  const owner = ownerPubkey.toLowerCase()
  const active = members
    .filter(m => m.membership_state !== 'PENDING')
    .map(m => m.pubkey.toLowerCase())
    .filter(pubkey => pubkey !== owner)
  return normalizeParticipants([owner, ...active])
}

/** True when the roster is small enough for a single NIP-17 room. */
export function circleChatFeasible(participants: string[]): boolean {
  return participants.length >= 2 && participants.length <= MAX_CIRCLE_CHAT_PARTICIPANTS
}
