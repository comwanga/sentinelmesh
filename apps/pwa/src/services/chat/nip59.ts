// NIP-59 gift wrapping + NIP-17 rumor/seal handling, built on the active signer
// so a bunker or NIP-07 identity can encrypt/sign without exposing a raw key.
// The outer gift wrap is always signed by a fresh one-time key generated locally.
import { finalizeEvent, generateSecretKey, nip44, verifyEvent } from 'nostr-tools'
import { getEventHash } from 'nostr-tools/pure'
import type { Event, VerifiedEvent } from 'nostr-tools'
import type { NostrSigner } from '../signerService'
import { isLowercaseHex64, singleTag } from './eventValidation'

export const NIP59_KIND_SEAL = 13
export const NIP59_KIND_GIFT_WRAP = 1059

const TWO_DAYS = 2 * 24 * 60 * 60
const randomNow = () => Math.floor(Date.now() / 1000 - Math.random() * TWO_DAYS)

export interface Rumor {
  pubkey: string
  id: string
  kind: number
  created_at: number
  tags: string[][]
  content: string
}

/** Build an UNSIGNED rumor whose id is its serialized event hash. */
export function createRumor(
  senderPubkey: string,
  event: { kind: number; tags?: string[][]; content?: string; created_at?: number },
): Rumor {
  const rumor = {
    pubkey: senderPubkey,
    kind: event.kind,
    created_at: event.created_at ?? Math.floor(Date.now() / 1000),
    tags: event.tags ?? [],
    content: event.content ?? '',
  }
  return { ...rumor, id: getEventHash(rumor) }
}

/** Sign a kind-13 seal around `rumor` for `recipientPubkey` using the signer. */
export async function createSeal(
  signer: NostrSigner,
  rumor: Rumor,
  recipientPubkey: string,
): Promise<VerifiedEvent> {
  const content = await signer.nip44Encrypt(recipientPubkey, JSON.stringify(rumor))
  return signer.signEvent({ kind: NIP59_KIND_SEAL, created_at: randomNow(), tags: [], content })
}

/** Wrap a seal in a kind-1059 gift wrap signed by a fresh one-time key. */
export function createWrap(seal: Event, recipientPubkey: string): VerifiedEvent {
  const ephemeral = generateSecretKey()
  const key = nip44.v2.utils.getConversationKey(ephemeral, recipientPubkey)
  try {
    const content = nip44.v2.encrypt(JSON.stringify(seal), key)
    return finalizeEvent(
      { kind: NIP59_KIND_GIFT_WRAP, created_at: randomNow(), tags: [['p', recipientPubkey]], content },
      ephemeral,
    )
  } finally {
    key.fill(0)
  }
}

/**
 * Unwrap a gift wrap and return the rumor, or null if any layer is invalid. The
 * processing order is strict: verify the wrapper signature and recipient binding
 * BEFORE decrypting, then the seal, then recompute the rumor id.
 */
export async function unwrapGiftWrap(signer: NostrSigner, wrap: Event): Promise<Rumor | null> {
  try {
    if (!verifyEvent(wrap) || wrap.kind !== NIP59_KIND_GIFT_WRAP) return null
    const myPubkey = await signer.pubkey()
    if (singleTag(wrap, 'p') !== myPubkey) return null

    const sealRaw = await signer.nip44Decrypt(wrap.pubkey, wrap.content)
    const seal = JSON.parse(sealRaw) as Event
    if (!verifyEvent(seal) || seal.kind !== NIP59_KIND_SEAL || seal.tags.length !== 0) return null

    const rumorRaw = await signer.nip44Decrypt(seal.pubkey, seal.content)
    const rumor = JSON.parse(rumorRaw) as Omit<Rumor, 'id'>
    if (!isLowercaseHex64(rumor.pubkey) || rumor.pubkey !== seal.pubkey) return null
    const id = getEventHash(rumor)
    return { ...rumor, id }
  } catch {
    return null
  }
}
