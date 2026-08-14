// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { createLocalNostrSigner } from '../../signerService'
import { createDirectMessage } from '../nip17'
import { processGiftWrap, inboxFilter } from '../inbox'

function signer(secretKey: Uint8Array) {
  return createLocalNostrSigner(secretKey, getPublicKey(secretKey))
}

describe('inbox', () => {
  test('builds a recipient-scoped kind-1059 filter', () => {
    const pubkey = 'a'.repeat(64)
    expect(inboxFilter(pubkey)).toEqual({ kinds: [1059], '#p': ['a'.repeat(64)] })
  })

  test('processes a gift wrap and dedupes by outer id', async () => {
    const alice = signer(generateSecretKey())
    const bob = signer(generateSecretKey())
    const bobPubkey = await bob.pubkey()
    const wraps = await createDirectMessage(alice, bobPubkey, 'secret hello')
    const bobWrap = wraps.find(w => w.tags.some(t => t[0] === 'p' && t[1] === bobPubkey))!

    const seen = new Set<string>()
    const processed = await processGiftWrap(bob, bobWrap, async id => seen.has(id), async id => { seen.add(id) })
    expect(processed).not.toBeNull()
    expect(processed!.content).toBe('secret hello')
    expect(processed!.participants).toHaveLength(2)
    expect(processed!.wrapId).toBe(bobWrap.id)

    const again = await processGiftWrap(bob, bobWrap, async id => seen.has(id), async id => { seen.add(id) })
    expect(again).toBeNull() // deduped
  })

  test('rejects a non-gift-wrap event', async () => {
    const alice = signer(generateSecretKey())
    const rumor = { pubkey: 'a'.repeat(64), id: 'b'.repeat(64), kind: 14, created_at: 1, tags: [], content: 'x' }
    const processed = await processGiftWrap(alice, rumor as never, async () => false, async () => {})
    expect(processed).toBeNull()
  })
})
