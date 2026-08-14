// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'

const localSecret = new Uint8Array(32).fill(7)

vi.mock('../bunkerStore', () => ({
  loadBunkerConnection: vi.fn(async () => null),
  saveBunkerConnection: vi.fn(),
  clearBunkerConnection: vi.fn(),
}))
vi.mock('../nostrService', () => ({ getCachedKeypair: () => ({ publicKey: 'a'.repeat(64), secretKey: localSecret }) }))
vi.mock('nostr-tools/nip46', () => ({ BunkerSigner: { fromBunker: vi.fn() } }))
vi.mock('nostr-tools/pool', () => ({ SimplePool: class { destroy() {} } }))

import { activateNip07Signer, getActiveIdentity, signWithActiveIdentity, initializeActiveSigner } from '../signerService'

function installNip07(): string {
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  const sign = (t: { kind: number; created_at: number; tags: string[][]; content: string }) =>
    Promise.resolve(finalizeEvent(t, sk))
  ;(globalThis as unknown as { window: { nostr: unknown } }).window = {
    nostr: { getPublicKey: () => Promise.resolve(pubkey), signEvent: sign },
  }
  return pubkey
}

beforeEach(async () => {
  vi.clearAllMocks()
  delete (globalThis as unknown as { window?: { nostr: unknown } }).window
  await initializeActiveSigner() // reset module state to local mode
})

describe('signerService NIP-07', () => {
  test('activates a NIP-07 extension identity', async () => {
    const pubkey = installNip07()
    const active = await activateNip07Signer()
    expect(active.mode).toBe('nip07')
    expect(active.pubkey).toBe(pubkey)
  })

  test('signs through the extension and verifies the result', async () => {
    const pubkey = installNip07()
    await activateNip07Signer()
    const template = { kind: 1, created_at: 1, tags: [], content: 'hi' }
    const event = await signWithActiveIdentity(template)
    expect(event.kind).toBe(1)
    expect(event.pubkey).toBe(pubkey)
  })

  test('throws when no extension is present', async () => {
    expect(getActiveIdentity().mode).toBe('local')
    await expect(activateNip07Signer()).rejects.toThrow('not available')
  })
})
