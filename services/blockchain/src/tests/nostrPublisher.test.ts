import { publishNostrEvents } from '../workers/nostrPublisher'

// Fully mock nostr-tools so Jest never loads the ESM-only @noble/curves dependency.
// We provide a fake finalizeEvent and a mock Relay.connect.
const mockClose = jest.fn()
const mockPublish = jest.fn()
const mockConnect = jest.fn()

jest.mock('nostr-tools', () => {
  const crypto = require('crypto')
  return {
    finalizeEvent: jest.fn(
      (template: { kind: number; created_at: number; tags: string[][]; content: string }) => {
        const id = crypto
          .createHash('sha256')
          .update(JSON.stringify([template.kind, template.tags, template.content]))
          .digest('hex')
        return { ...template, id, pubkey: 'fakepubkey', sig: 'fakesig' }
      },
    ),
    Relay: {
      connect: (...args: unknown[]) => mockConnect(...args),
    },
  }
})

describe('publishNostrEvents', () => {
  const privkeyHex = '0000000000000000000000000000000000000000000000000000000000000001'
  const payload = {
    source_id: 'test-uuid-1234',
    source_type: 'SAFETY_EVENT' as const,
    severity: 'CRITICAL',
    event_type: 'SHOOTING',
    lat: 37.7749,
    lng: -122.4194,
    place_name: 'Test Location',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockConnect.mockResolvedValue({ publish: mockPublish, close: mockClose })
    mockPublish.mockResolvedValue(undefined)
  })

  it('returns kind1_id and kind30078_id as 64-char hex strings', async () => {
    const result = await publishNostrEvents(privkeyHex, ['wss://relay.test'], payload)
    expect(result.kind1_id).toMatch(/^[0-9a-f]{64}$/)
    expect(result.kind30078_id).toMatch(/^[0-9a-f]{64}$/)
  })

  it('publishes exactly 2 events per relay (kind 1 and kind 30078)', async () => {
    await publishNostrEvents(privkeyHex, ['wss://relay.test'], payload)
    expect(mockPublish).toHaveBeenCalledTimes(2)
  })

  it('closes the relay after publishing', async () => {
    await publishNostrEvents(privkeyHex, ['wss://relay.test'], payload)
    expect(mockClose).toHaveBeenCalled()
  })

  it('throws when all relays fail to connect', async () => {
    mockConnect.mockRejectedValue(new Error('connection refused'))

    await expect(
      publishNostrEvents(privkeyHex, ['wss://bad.relay'], payload),
    ).rejects.toThrow()
  })
})
