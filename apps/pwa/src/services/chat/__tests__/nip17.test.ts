// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { generateSecretKey, getPublicKey, type Event } from 'nostr-tools'
import { createLocalNostrSigner } from '../../signerService'
import { createDirectMessage, createGroupMessage, unwrapMessage } from '../nip17'

function signer(secretKey: Uint8Array) {
  return createLocalNostrSigner(secretKey, getPublicKey(secretKey))
}

function wrapFor(wraps: Event[], pubkey: string): Event {
  return wraps.find(w => w.tags.some(t => t[0] === 'p' && t[1] === pubkey))!
}

describe('nip17 messaging', () => {
  test('direct message round-trips with a self-copy', async () => {
    const alice = signer(generateSecretKey())
    const bob = signer(generateSecretKey())
    const alicePubkey = await alice.pubkey()
    const bobPubkey = await bob.pubkey()

    const wraps = await createDirectMessage(alice, bobPubkey, 'hello bob')
    expect(wraps).toHaveLength(2) // recipient + self

    const received = await unwrapMessage(bob, wrapFor(wraps, bobPubkey))
    expect(received).not.toBeNull()
    expect(received!.rumor.content).toBe('hello bob')
    expect(received!.participants).toHaveLength(2)

    // Self-copy also unwraps for the sender.
    const selfCopy = await unwrapMessage(alice, wrapFor(wraps, alicePubkey))
    expect(selfCopy).not.toBeNull()
  })

  test('group message round-trips for each participant', async () => {
    const alice = signer(generateSecretKey())
    const bob = signer(generateSecretKey())
    const carol = signer(generateSecretKey())
    const bobPubkey = await bob.pubkey()
    const carolPubkey = await carol.pubkey()

    const wraps = await createGroupMessage(alice, [bobPubkey, carolPubkey], 'family check-in')
    expect(wraps).toHaveLength(3) // self + 2 recipients

    const fromBob = await unwrapMessage(bob, wrapFor(wraps, bobPubkey))
    expect(fromBob?.rumor.content).toBe('family check-in')
    expect(fromBob?.participants).toHaveLength(3)
  })

  test('rejects messages from a non-participant', async () => {
    const alice = signer(generateSecretKey())
    const bob = signer(generateSecretKey())
    const eve = signer(generateSecretKey())
    const bobPubkey = await bob.pubkey()
    const wraps = await createDirectMessage(alice, bobPubkey, 'hi')
    expect(await unwrapMessage(eve, wrapFor(wraps, bobPubkey))).toBeNull()
  })

  test('rejects oversized participant sets', async () => {
    const alice = signer(generateSecretKey())
    const many = Array.from({ length: 11 }, () => getPublicKey(generateSecretKey()))
    await expect(createGroupMessage(alice, many, 'too big')).rejects.toThrow('too many participants')
  })
})
