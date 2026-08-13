import { beforeEach, describe, expect, test, vi } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'

const { stored, save, clear, fromBunker, localSecret } = vi.hoisted(() => ({
  stored: { value: null as null | { clientSecretKey: Uint8Array; bunkerPubkey: string; relays: string[]; secret: string | null; expectedPubkey: string } },
  save: vi.fn(),
  clear: vi.fn(),
  fromBunker: vi.fn(),
  localSecret: new Uint8Array(32).fill(3),
}))

vi.mock('../bunkerStore', () => ({
  loadBunkerConnection: vi.fn(async () => stored.value),
  saveBunkerConnection: save,
  clearBunkerConnection: clear,
}))
vi.mock('../nostrService', () => ({ getCachedKeypair: () => ({ publicKey: 'c'.repeat(64), secretKey: localSecret }) }))
vi.mock('nostr-tools/nip46', () => ({ BunkerSigner: { fromBunker } }))
vi.mock('nostr-tools/pool', () => ({ SimplePool: class { destroy() {} } }))

import { connectBunker, getActiveIdentity, initializeActiveSigner, signWithActiveIdentity } from '../signerService'

beforeEach(() => {
  stored.value = null
  vi.clearAllMocks()
})

describe('signerService', () => {
  test('loads persisted bunker identity offline without connecting', async () => {
    stored.value = { clientSecretKey: generateSecretKey(), bunkerPubkey: 'a'.repeat(64), relays: ['wss://relay.example.com'], secret: null, expectedPubkey: 'b'.repeat(64) }
    await initializeActiveSigner()
    expect(getActiveIdentity()).toEqual({ mode: 'bunker', pubkey: 'b'.repeat(64), status: 'offline' })
    expect(fromBunker).not.toHaveBeenCalled()
  })

  test.each([
    'nostrconnect://example.com',
    `bunker://${'a'.repeat(64)}`,
    `bunker://${'a'.repeat(64)}?relay=ws%3A%2F%2Frelay.example.com`,
    `bunker://${'a'.repeat(64)}?relay=wss%3A%2F%2Fuser%3Apass%40relay.example.com`,
    `bunker://${'a'.repeat(64)}?relay=wss%3A%2F%2Frelay.example.com&unexpected=true`,
    `bunker://${'a'.repeat(64)}/unexpected?relay=wss%3A%2F%2Frelay.example.com`,
  ])('rejects unsafe pointer %s', async pointer => {
    await initializeActiveSigner()
    await expect(connectBunker(pointer)).rejects.toThrow()
    expect(fromBunker).not.toHaveBeenCalled()
  })

  test('never falls back to local signing while bunker mode is offline', async () => {
    stored.value = { clientSecretKey: generateSecretKey(), bunkerPubkey: 'a'.repeat(64), relays: ['wss://relay.example.com'], secret: null, expectedPubkey: 'b'.repeat(64) }
    await initializeActiveSigner()
    const template = { kind: 1, created_at: 1, tags: [], content: 'test' }
    const localEvent = finalizeEvent(template, localSecret)
    await expect(signWithActiveIdentity(template)).rejects.toThrow('Remote signer is offline')
    expect(getActiveIdentity().pubkey).not.toBe(localEvent.pubkey)
  })
})
