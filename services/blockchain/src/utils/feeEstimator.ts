const ANCHOR_TX_VBYTES = 154
const FALLBACK_SAT_PER_VBYTE = 20
const MIN_FEE_SATS = 1000

const FEE_URL: Record<'mainnet' | 'testnet', string> = {
  mainnet: 'https://mempool.space/api/v1/fees/recommended',
  testnet: 'https://mempool.space/testnet/api/v1/fees/recommended',
}

export async function estimateFee(network: 'mainnet' | 'testnet'): Promise<number> {
  try {
    const res = await fetch(FEE_URL[network], { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { hourFee: number }
    return Math.max(data.hourFee * ANCHOR_TX_VBYTES, MIN_FEE_SATS)
  } catch (err) {
    console.warn('[feeEstimator] using fallback fee rate:', err)
    return FALLBACK_SAT_PER_VBYTE * ANCHOR_TX_VBYTES
  }
}
