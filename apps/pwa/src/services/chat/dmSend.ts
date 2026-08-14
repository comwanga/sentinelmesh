// NIP-17 sending: build gift wraps (direct or group), resolve the conversation
// id, and map each wrap to its recipient for outbox routing.
import type { Event } from 'nostr-tools'
import type { NostrSigner } from '../signerService'
import { createDirectMessage, createGroupMessage } from './nip17'
import { normalizeParticipants } from './conversationId'
import { directConversationId, roomConversationId } from './dmConversation'

export interface SentMessage {
  wraps: Event[]
  conversationId: string
  participants: string[]
}

export async function sendDirectMessage(
  signer: NostrSigner,
  recipientPubkey: string,
  content: string,
): Promise<SentMessage> {
  const wraps = await createDirectMessage(signer, recipientPubkey, content)
  const myPubkey = await signer.pubkey()
  const participants = normalizeParticipants([myPubkey, recipientPubkey])
  const conversationId = await directConversationId(myPubkey, recipientPubkey)
  return { wraps, conversationId, participants }
}

export async function sendGroupMessage(
  signer: NostrSigner,
  recipients: string[],
  content: string,
): Promise<SentMessage> {
  const wraps = await createGroupMessage(signer, recipients, content)
  const myPubkey = await signer.pubkey()
  const participants = normalizeParticipants([myPubkey, ...recipients])
  const conversationId = await roomConversationId(participants)
  return { wraps, conversationId, participants }
}

/** Map each gift wrap to its single recipient pubkey (for relay routing). */
export function wrapsByRecipient(wraps: Event[]): Map<string, Event> {
  const map = new Map<string, Event>()
  for (const wrap of wraps) {
    const recipient = wrap.tags.find(t => t[0] === 'p')?.[1]
    if (recipient) map.set(recipient, wrap)
  }
  return map
}
