// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { createLocalNostrSigner } from '../../signerService'
import { nip42AuthTemplate, signNip42Auth, automaticAuth, NIP42_AUTH_KIND } from '../relayAuth'

describe('relayAuth', () => {
  test('builds a kind-22242 template bound to relay and challenge', () => {
    const t = nip42AuthTemplate('wss://relay.example.com', 'abc123')
    expect(t.kind).toBe(NIP42_AUTH_KIND)
    expect(t.tags).toContainEqual(['relay', 'wss://relay.example.com'])
    expect(t.tags).toContainEqual(['challenge', 'abc123'])
  })

  test('signs a NIP-42 auth event with the active signer', async () => {
    const sk = generateSecretKey()
    const signer = createLocalNostrSigner(sk, getPublicKey(sk))
    const event = await signNip42Auth(signer, 'wss://relay.example.com', 'challenge')
    expect(event.kind).toBe(NIP42_AUTH_KIND)
    expect(event.pubkey).toBe(getPublicKey(sk))
  })

  test('automaticAuth signs the relay challenge template', async () => {
    const sk = generateSecretKey()
    const signer = createLocalNostrSigner(sk, getPublicKey(sk))
    const authFn = automaticAuth(signer)('wss://relay.example.com')
    const template = { kind: 22242, created_at: 1, tags: [['challenge', 'x']], content: '' }
    const signed = await authFn(template)
    expect(signed.id).toBeDefined()
    expect(signed.pubkey).toBe(getPublicKey(sk))
  })
})
