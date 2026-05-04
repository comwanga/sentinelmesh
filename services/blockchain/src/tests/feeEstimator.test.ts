const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

import { estimateFee } from '../utils/feeEstimator'

beforeEach(() => mockFetch.mockReset())

describe('estimateFee', () => {
  it('returns hourFee * 154 when mempool.space responds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ fastestFee: 50, halfHourFee: 30, hourFee: 10, economyFee: 5 }),
    })
    const fee = await estimateFee('testnet')
    expect(fee).toBe(10 * 154)  // 1540
  })

  it('enforces 1000 sat floor when hourFee is very low', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ fastestFee: 10, halfHourFee: 8, hourFee: 5, economyFee: 2 }),
    })
    const fee = await estimateFee('testnet')
    expect(fee).toBe(1000)  // 5 * 154 = 770, floored to 1000
  })

  it('falls back to 3080 sats on 5xx and logs a warning', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 })
    const fee = await estimateFee('testnet')
    expect(fee).toBe(20 * 154)  // 3080
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[feeEstimator]'), expect.anything())
    warnSpy.mockRestore()
  })

  it('falls back to 3080 sats on network timeout', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('timeout', 'AbortError'))
    const fee = await estimateFee('mainnet')
    expect(fee).toBe(3080)
  })

  it('uses mainnet URL for mainnet network', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ hourFee: 10, fastestFee: 50, halfHourFee: 30, economyFee: 5 }),
    })
    await estimateFee('mainnet')
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('mempool.space/api/v1/fees')
    expect(calledUrl).not.toContain('testnet')
  })
})
