// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { createLocalNostrSigner } from '../../signerService'
import { createRumor, createSeal, createWrap, unwrapGiftWrap } from '../nip59'

function signer(secretKey: Uint8Array) {
  return createLocalNostrSigner(secretKey, getPublicKey(secretKey))
}

describe('nip59 gift wrap', () => {
  test('round-trips a rumor through seal and gift wrap', async () => {
    const alice = signer(generateSecretKey())
    const bob = signer(generateSecretKey())
    const alicePubkey = await alice.pubkey()
    const bobPubkey = await bob.pubkey()

    const rumor = createRumor(alicePubkey, { kind: 14, tags: [['p', bobPubkey]], content: 'hi bob' })
    expect(rumor.id).toMatch(/^[0-9a-f]{64}$/)

    const seal = await createSeal(alice, rumor, bobPubkey)
    expect(seal.kind).toBe(13)
    expect(seal.tags).toHaveLength(0)

    const wrap = createWrap(seal, bobPubkey)
    expect(wrap.kind).toBe(1059)
    expect(wrap.tags).toEqual([['p', bobPubkey]])

    const unwrapped = await unwrapGiftWrap(bob, wrap)
    expect(unwrapped).not.toBeNull()
    expect(unwrapped!.content).toBe('hi bob')
    expect(unwrapped!.id).toBe(rumor.id)
    expect(unwrapped!.pubkey).toBe(alicePubkey)
  })

  test('rejects a wrap addressed to a different recipient', async () => {
    const alice = signer(generateSecretKey())
    const bob = signer(generateSecretKey())
    const carol = signer(generateSecretKey())
    const rumor = createRumor(await alice.pubkey(), { kind: 14, tags: [['p', await bob.pubkey()]], content: 'hi' })
    const seal = await createSeal(alice, rumor, await bob.pubkey())
    const wrap = createWrap(seal, await bob.pubkey())
    expect(await unwrapGiftWrap(carol, wrap)).toBeNull()
  })

  test('rejects a tampered wrapper', async () => {
    const alice = signer(generateSecretKey())
    const bob = signer(generateSecretKey())
    const rumor = createRumor(await alice.pubkey(), { kind: 14, tags: [['p', await bob.pubkey()]], content: 'hi' })
    const seal = await createSeal(alice, rumor, await bob.pubkey())
    const wrap = createWrap(seal, await bob.pubkey())
    // Simulate a received event (no local verification cache) with tampered content.
    const received = JSON.parse(JSON.stringify(wrap)) as typeof wrap
    received.content = received.content.slice(0, -1) + '0'
    expect(await unwrapGiftWrap(bob, received)).toBeNull()
  })
})
