// NIP-17 inbox: subscribe to and process kind-1059 gift wraps addressed to the
// active pubkey. Dedup by outer wrap id, unwrap/validate, then derive the room.
import type { Event, Filter } from 'nostr-tools'
import type { NostrSigner } from '../signerService'
import { unwrapMessage } from './nip17'
import { roomConversationId } from './dmConversation'

export const NIP17_INBOX_KIND = 1059

export interface ProcessedInboxMessage {
  conversationId: string
  participants: string[]
  senderPubkey: string
  content: string
  created_at: number
  rumorId: string
  wrapId: string
}

export function inboxFilter(pubkey: string): Filter {
  return { kinds: [NIP17_INBOX_KIND], '#p': [pubkey.toLowerCase()] }
}

/**
 * Process a single gift wrap. Returns null for non-gift-wraps, already-seen
 * wraps, or any layer that fails validation/decryption. `isSeen`/`markSeen`
 * let the caller back deduplication (e.g. IndexedDB) so a poison event is never
 * repeatedly decrypted.
 */
export async function processGiftWrap(
  signer: NostrSigner,
  wrap: Event,
  isSeen: (outerId: string) => Promise<boolean>,
  markSeen: (outerId: string) => Promise<void>,
): Promise<ProcessedInboxMessage | null> {
  if (wrap.kind !== NIP17_INBOX_KIND) return null
  if (await isSeen(wrap.id)) return null
  const unwrapped = await unwrapMessage(signer, wrap)
  if (!unwrapped) return null
  const conversationId = await roomConversationId(unwrapped.participants)
  await markSeen(wrap.id)
  return {
    conversationId,
    participants: unwrapped.participants,
    senderPubkey: unwrapped.rumor.pubkey,
    content: unwrapped.rumor.content,
    created_at: unwrapped.rumor.created_at,
    rumorId: unwrapped.rumor.id,
    wrapId: wrap.id,
  }
}
