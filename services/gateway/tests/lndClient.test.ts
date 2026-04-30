import { describe, it, expect, vi, beforeEach } from 'vitest'

// Set required env vars before importing so the lazy config initializer finds them.
process.env['LND_REST_URL'] = 'https://localhost:8080'
process.env['LND_MACAROON_HEX'] = 'deadbeef'

import { createInvoice, getInvoice } from '../src/lightning/lndClient'

// Helper to build a minimal Response-like object for vi.stubGlobal.
function makeFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('createInvoice', () => {
  it('calls POST /v1/invoices with correct body and macaroon header', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeFetchResponse({ payment_request: 'lnbc...', r_hash: 'AAEC' })
    )
    vi.stubGlobal('fetch', mockFetch)

    await createInvoice({ amountSats: 1000, memo: 'test payment' })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://localhost:8080/v1/invoices')
    expect(options.method).toBe('POST')
    expect((options.headers as Record<string, string>)['Grpc-Metadata-macaroon']).toBe('deadbeef')
    expect(JSON.parse(options.body as string)).toEqual({
      value: 1000,
      memo: 'test payment',
      expiry: 3600,
    })
  })

  it('converts r_hash base64 to hex correctly', async () => {
    // bytes 0x00 0x01 0x02 encode as AAEC in base64
    const mockFetch = vi.fn().mockResolvedValue(
      makeFetchResponse({ payment_request: 'lnbc...', r_hash: 'AAEC' })
    )
    vi.stubGlobal('fetch', mockFetch)

    const result = await createInvoice({ amountSats: 500, memo: 'hex test' })

    expect(result.payment_hash).toBe('000102')
  })

  it('throws when fetch response is not ok (status 400)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeFetchResponse({ error: 'bad request' }, false, 400)
    )
    vi.stubGlobal('fetch', mockFetch)

    await expect(createInvoice({ amountSats: 100, memo: 'fail' })).rejects.toThrow('400')
  })
})

describe('getInvoice', () => {
  it('calls GET /v1/invoice/{base64url_hash} with macaroon header', async () => {
    const invoiceData = { settled: false, amt_paid_sat: '0', payment_request: 'lnbc...' }
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse(invoiceData))
    vi.stubGlobal('fetch', mockFetch)

    // hex 000102 -> base64url AAEC
    await getInvoice('000102')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://localhost:8080/v1/invoice/AAEC')
    expect((options.headers as Record<string, string>)['Grpc-Metadata-macaroon']).toBe('deadbeef')
    expect(options.method).toBe('GET')
  })

  it('returns the settled field from the LND response', async () => {
    const invoiceData = { settled: true, amt_paid_sat: '1000', payment_request: 'lnbc...' }
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse(invoiceData))
    vi.stubGlobal('fetch', mockFetch)

    const result = await getInvoice('000102')

    expect(result['settled']).toBe(true)
  })
})
