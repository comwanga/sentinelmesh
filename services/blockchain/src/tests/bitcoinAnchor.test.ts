import { broadcastAnchor, AnchorInput, PreBroadcastError, PostBroadcastError } from '../workers/bitcoinAnchor'

const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

const input: AnchorInput = {
  anchorHash: 'a'.repeat(64),
  wif: 'cUoemJTdeyiQddUMvAjXniMe82DyfqXYJr99etRyHMDPjuUUXJUe',  // valid testnet WIF
  utxoTxid: 'b'.repeat(64),
  utxoVout: 0,
  utxoValue: 50000,  // 50k sats — enough for fee 3080 + dust 546
  fee: 3080,
  network: 'testnet',
}

beforeEach(() => mockFetch.mockReset())

describe('broadcastAnchor', () => {
  it('throws PreBroadcastError when utxo value is insufficient (no fetch called)', async () => {
    const lowInput: AnchorInput = { ...input, utxoValue: 500 }
    await expect(broadcastAnchor(lowInput)).rejects.toBeInstanceOf(PreBroadcastError)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns { txid, changeVout, changeValue } on success', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => 'ignored-txid-from-server' })
    const result = await broadcastAnchor(input)
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/)
    expect(result.changeVout).toBe(1)
    expect(result.changeValue).toBe(50000 - 3080)  // 46920
  })

  it('falls back to blockstream.info on mempool.space 5xx', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'error' })
      .mockResolvedValueOnce({ ok: true, text: async () => 'ignored' })
    const result = await broadcastAnchor(input)
    expect(result.txid).toMatch(/^[0-9a-f]{64}$/)
    expect((mockFetch.mock.calls[1][0] as string)).toContain('blockstream.info')
  })

  it('throws PostBroadcastError with txid when both endpoints fail', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'error' })
    let caught: unknown
    try { await broadcastAnchor(input) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(PostBroadcastError)
    const err = caught as PostBroadcastError
    expect(err.txid).toMatch(/^[0-9a-f]{64}$/)
    expect(err.changeVout).toBe(1)
    expect(err.changeValue).toBe(46920)
  })

  it('uses mainnet endpoints for mainnet network', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => 'ignored' })
    const mainnetInput: AnchorInput = {
      ...input,
      wif: 'KzgQnXTBUx1FBKpDrC2TR287cT3GwXCZx5GncKniwdBRBVD9yLAe',
      network: 'mainnet',
    }
    await broadcastAnchor(mainnetInput)
    const calledUrl = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).not.toContain('testnet')
    expect(calledUrl).toContain('mempool.space')
  })
})
