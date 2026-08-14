// Encrypted (NIP-17) conversation identity. Direct conversations are keyed by
// the two participants; Circle rooms are keyed by their full participant set so
// a roster change naturally creates a new room with clean history.
import { conversationIdFor, normalizeParticipants } from './conversationId'
import { isLowercaseHex64 } from './eventValidation'

export interface DirectConversation {
  id: string
  participants: string[]
  title: string
}

/** Conversation id for a direct (1:1) conversation. */
export async function directConversationId(a: string, b: string): Promise<string> {
  return conversationIdFor([a, b])
}

/** Conversation id for a group/Circle room from a participant set. */
export async function roomConversationId(participants: string[]): Promise<string> {
  return conversationIdFor(participants)
}

/** Normalize a list of participant pubkeys, excluding the local sender. */
export function peerParticipants(myPubkey: string, others: string[]): string[] {
  const mine = myPubkey.toLowerCase()
  return normalizeParticipants(others).filter(p => p !== mine)
}

/** Build a stable conversation summary from a recipient set. */
export async function buildDirectConversation(
  myPubkey: string,
  recipientPubkey: string,
  title?: string,
): Promise<DirectConversation> {
  if (!isLowercaseHex64(recipientPubkey)) throw new Error('invalid recipient public key')
  const participants = normalizeParticipants([myPubkey, recipientPubkey])
  const id = await conversationIdFor(participants)
  return { id, participants, title: title ?? recipientPubkey.slice(0, 12) }
}
