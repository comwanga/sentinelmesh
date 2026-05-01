import { describe, it, expect, vi, beforeEach } from 'vitest'

// Valid 32-byte hex private key for signing Nostr events in tests.
process.env['NOSTR_PRIVATE_KEY'] = 'a'.repeat(64)

// Mock the LND client so no real HTTP calls happen.
vi.mock('../src/lightning/lndClient', () => ({
  createInvoice: vi.fn().mockResolvedValue({
    payment_request: 'lnbc500n1...',
    payment_hash: 'abc123',
  }),
}))

// Mock the DB pool with a stable singleton so tests can configure responses.
// Using a module-scope object inside the factory keeps the same reference
// across all getPool() calls (both in service code and in tests).
vi.mock('../src/db/pool', () => {
  const sharedQuery = vi.fn()
  const sharedPool = { query: sharedQuery }
  return { getPool: () => sharedPool }
})

// Mock the Nostr relay so no real WebSocket connections happen.
vi.mock('nostr-tools/relay', () => ({
  Relay: {
    connect: vi.fn().mockResolvedValue({
      publish: vi.fn(),
      close: vi.fn(),
    }),
  },
}))

import { createZapRequest, handlePaymentWebhook } from '../src/lightning/zapService'
import { getPool } from '../src/db/pool'
import { Relay } from 'nostr-tools/relay'

// Helpers to get the mocked instances for each test.
function getMockQuery() {
  return (getPool() as { query: ReturnType<typeof vi.fn> }).query
}

function getMockRelay() {
  return Relay as unknown as { connect: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Re-set the default relay mock after clearAllMocks wipes it.
  getMockRelay().connect.mockResolvedValue({ publish: vi.fn(), close: vi.fn() })
})

describe('createZapRequest', () => {
  it('returns zap_id, payment_request, and amount_sats on success', async () => {
    const mockQuery = getMockQuery()
    // First query returns a report row; second query returns the new zap id.
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'report-uuid', nostr_pubkey: 'pubkeyabc', report_type: 'hazard' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'zap-uuid-001' }],
      })

    const result = await createZapRequest('report-uuid', 1000)

    expect(result.zap_id).toBe('zap-uuid-001')
    expect(result.payment_request).toBe('lnbc500n1...')
    expect(result.amount_sats).toBe(1000)
  })

  it('throws "report not found" when the report does not exist', async () => {
    const mockQuery = getMockQuery()
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(createZapRequest('missing-id', 500)).rejects.toThrow('report not found')
  })

  it('throws "amount exceeds maximum" when amountSats > 100000', async () => {
    const mockQuery = getMockQuery()

    await expect(createZapRequest('any-id', 100_001)).rejects.toThrow(
      'amount exceeds maximum of 100000 sats'
    )

    // DB should not have been called at all.
    expect(mockQuery).not.toHaveBeenCalled()
  })
})

describe('handlePaymentWebhook', () => {
  it('returns silently when the payment_hash is not found in the DB', async () => {
    const mockQuery = getMockQuery()
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await expect(handlePaymentWebhook('unknown-hash')).resolves.toBeUndefined()

    // No UPDATE should have been issued.
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('issues UPDATE and publishes a Nostr event when zap is pending', async () => {
    const mockQuery = getMockQuery()
    const mockPublish = vi.fn()
    const mockClose = vi.fn()
    getMockRelay().connect.mockResolvedValueOnce({ publish: mockPublish, close: mockClose })

    // First query returns the pending zap.
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'zap-uuid-002',
            status: 'pending',
            recipient_pubkey: 'deadbeefpubkey',
            bolt11_invoice: 'lnbc1...',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE paid
      .mockResolvedValueOnce({ rows: [] }) // UPDATE receipt

    await handlePaymentWebhook('payhash456')

    // Three DB calls: SELECT, UPDATE paid, UPDATE receipt.
    expect(mockQuery).toHaveBeenCalledTimes(3)

    // The first UPDATE should set status = 'paid'.
    const updatePaidCall = mockQuery.mock.calls[1] as [string, unknown[]]
    expect(updatePaidCall[0]).toContain("status = 'paid'")

    // Nostr relay should have been connected and the event published.
    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockClose).toHaveBeenCalledTimes(1)

    // The second UPDATE should store the receipt.
    const updateReceiptCall = mockQuery.mock.calls[2] as [string, unknown[]]
    expect(updateReceiptCall[0]).toContain('zap_receipt_id')
  })
})
