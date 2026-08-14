// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { createLocalNostrSigner } from '../../signerService'
import { sendDirectMessage, sendGroupMessage, wrapsByRecipient } from '../dmSend'

function signer(secretKey: Uint8Array) {
  return createLocalNostrSigner(secretKey, getPublicKey(secretKey))
}

describe('dmSend', () => {
  test('sendDirectMessage returns self + recipient wraps and a conversation id', async () => {
    const alice = signer(generateSecretKey())
    const bobPubkey = getPublicKey(generateSecretKey())
    const sent = await sendDirectMessage(alice, bobPubkey, 'hi')
    expect(sent.wraps).toHaveLength(2)
    expect(sent.participants).toHaveLength(2)
    expect(sent.conversationId).toMatch(/^[0-9a-f]{64}$/)
  })

  test('sendGroupMessage returns one wrap per participant plus self', async () => {
    const alice = signer(generateSecretKey())
    const peers = [getPublicKey(generateSecretKey()), getPublicKey(generateSecretKey())]
    const sent = await sendGroupMessage(alice, peers, 'group')
    expect(sent.wraps).toHaveLength(3)
    expect(sent.participants).toHaveLength(3)
  })

  test('wrapsByRecipient maps each wrap to its p tag', async () => {
    const alice = signer(generateSecretKey())
    const bobPubkey = getPublicKey(generateSecretKey())
    const sent = await sendDirectMessage(alice, bobPubkey, 'hi')
    const map = wrapsByRecipient(sent.wraps)
    expect(map.has(bobPubkey)).toBe(true)
    expect(map.has(await alice.pubkey())).toBe(true)
  })
})
