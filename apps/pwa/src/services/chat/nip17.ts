// NIP-17 direct and group messaging. Rumor + seal + gift wrap, with a self-copy
// for the sender so all parties share one history. Family Circle rooms are just
// multi-peer NIP-17 rooms whose participant set is derived from the roster.
import type { Event } from 'nostr-tools'
import type { NostrSigner } from '../signerService'
import { normalizeParticipants } from './conversationId'
import { isLowercaseHex64, MAX_ROOM_PARTICIPANTS, validMessageContent } from './eventValidation'
import { createRumor, createSeal, createWrap, unwrapGiftWrap, type Rumor } from './nip59'

export const NIP17_DIRECT_KIND = 14

export interface UnwrappedMessage {
  rumor: Rumor
  participants: string[]
}

/** Validate a rumor's participant tags: unique lowercase hex, incl. the sender. */
function participantSet(rumor: Rumor): string[] | null {
  if (rumor.kind !== NIP17_DIRECT_KIND) return null
  if (rumor.tags.length > MAX_ROOM_PARTICIPANTS) return null
  const others = rumor.tags.filter(t => t[0] === 'p').map(t => t[1])
  if (others.length === 0 || others.some(p => typeof p !== 'string' || !isLowercaseHex64(p))) return null
  if (new Set(others).size !== others.length) return null
  return normalizeParticipants([rumor.pubkey, ...others])
}

async function wrapRumor(
  signer: NostrSigner,
  rumor: Rumor,
  recipients: string[],
): Promise<Event[]> {
  const wraps: Event[] = []
  for (const recipient of recipients) {
    const seal = await createSeal(signer, rumor, recipient)
    wraps.push(createWrap(seal, recipient))
  }
  return wraps
}

/** Send a direct message: one wrap for the recipient plus one self-copy. */
export async function createDirectMessage(
  signer: NostrSigner,
  recipientPubkey: string,
  content: string,
): Promise<Event[]> {
  if (!validMessageContent(content)) throw new Error('invalid message content')
  if (!isLowercaseHex64(recipientPubkey)) throw new Error('invalid recipient public key')
  const senderPubkey = await signer.pubkey()
  if (recipientPubkey === senderPubkey.toLowerCase()) throw new Error('cannot message yourself')
  const rumor = createRumor(senderPubkey, { kind: NIP17_DIRECT_KIND, tags: [['p', recipientPubkey.toLowerCase()]], content })
  return wrapRumor(signer, rumor, [senderPubkey, recipientPubkey.toLowerCase()])
}

/** Send a group message to a fixed participant set (incl. self-copy). */
export async function createGroupMessage(
  signer: NostrSigner,
  recipients: string[],
  content: string,
): Promise<Event[]> {
  if (!validMessageContent(content)) throw new Error('invalid message content')
  const senderPubkey = await signer.pubkey()
  const participants = normalizeParticipants([senderPubkey, ...recipients])
  if (participants.length > MAX_ROOM_PARTICIPANTS) throw new Error('room has too many participants')
  if (participants.length < 2) throw new Error('room needs at least one other participant')
  const rumor = createRumor(senderPubkey, { kind: NIP17_DIRECT_KIND, tags: participants.map(p => ['p', p]), content })
  return wrapRumor(signer, rumor, participants)
}

/** Unwrap and validate an inbound gift wrap into a message with its room. */
export async function unwrapMessage(signer: NostrSigner, wrap: Event): Promise<UnwrappedMessage | null> {
  const rumor = await unwrapGiftWrap(signer, wrap)
  if (!rumor) return null
  if (!validMessageContent(rumor.content)) return null
  const participants = participantSet(rumor)
  if (!participants) return null
  const myPubkey = await signer.pubkey()
  if (!participants.includes(myPubkey)) return null
  return { rumor, participants }
}
