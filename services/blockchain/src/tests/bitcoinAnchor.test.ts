import { broadcastAnchor, AnchorInput } from '../workers/bitcoinAnchor'

// Mock global fetch (Node 18+)
const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

describe('broadcastAnchor', () => {
  const input: AnchorInput = {
    anchorHash: 'a'.repeat(64),  // 32 bytes as hex
    wif: 'cUoemJTdeyiQddUMvAjXniMe82DyfqXYJr99etRyHMDPjuUUXJUe',  // valid testnet WIF
    utxoTxid: 'b'.repeat(64),
    utxoVout: 0,
    utxoValue: 10000,
    changeAddress: 'tb1qu2twjgkf432nd5yt2qtku9fqvwh0e5yqspv0rf',  // valid testnet p2wpkh
    network: 'testnet',
  }

  beforeEach(() => mockFetch.mockReset())

  it('broadcasts to mempool.space testnet and returns txid on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => 'deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
    })
    const result = await broadcastAnchor(input)
    expect(result).toBe('deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678')
    const callUrl = (mockFetch.mock.calls[0][0] as string)
    expect(callUrl).toContain('testnet')
    expect(callUrl).toContain('mempool.space')
  })

  it('falls back to blockstream.info on mempool.space 5xx', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'service unavailable' })
      .mockResolvedValueOnce({ ok: true, text: async () => 'cafebabe5678901234567890123456789012345678901234567890123456cafe' })
    const result = await broadcastAnchor(input)
    expect(result).toMatch(/cafebabe/)
    expect((mockFetch.mock.calls[1][0] as string)).toContain('blockstream.info')
  })

  it('throws if both endpoints fail', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'error' })
    await expect(broadcastAnchor(input)).rejects.toThrow('Bitcoin broadcast failed')
  })

  it('uses mainnet endpoints when network is mainnet', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => 'aaaa1234567890abcdef1234567890abcdef1234567890abcdef1234567890aa',
    })
    const mainnetInput: AnchorInput = {
      ...input,
      wif: 'KzgQnXTBUx1FBKpDrC2TR287cT3GwXCZx5GncKniwdBRBVD9yLAe',  // valid mainnet WIF
      network: 'mainnet',
      changeAddress: 'bc1q75dlt4ufxsms8fyywezn4ekhdyxc2d5skd4trr',  // mainnet p2wpkh
    }
    await broadcastAnchor(mainnetInput)
    const callUrl = (mockFetch.mock.calls[0][0] as string)
    expect(callUrl).not.toContain('testnet')
    expect(callUrl).toContain('mempool.space')
  })
})
