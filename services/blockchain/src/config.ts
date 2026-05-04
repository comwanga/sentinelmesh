const REQUIRED_ENV = ['DATABASE_URL', 'NOSTR_PRIVKEY', 'BITCOIN_WIF'] as const
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[blockchain] Missing required env var: ${key}`)
    process.exit(1)
  }
}

function parseBitcoinNetwork(v: string): 'mainnet' | 'testnet' {
  if (v === 'mainnet' || v === 'testnet') return v
  throw new Error(`Invalid BITCOIN_NETWORK "${v}". Must be "mainnet" or "testnet".`)
}

export const config = {
  port: parseInt(process.env.BLOCKCHAIN_PORT ?? '3003', 10),
  databaseUrl: process.env.DATABASE_URL ?? '',
  nostrPrivkey: process.env.NOSTR_PRIVKEY ?? '',
  relayUrls: (process.env.RELAY_URLS ?? 'wss://relay.damus.io').split(',').map(s => s.trim()),
  bitcoinWif: process.env.BITCOIN_WIF ?? '',
  bitcoinNetwork: parseBitcoinNetwork(process.env.BITCOIN_NETWORK ?? 'testnet'),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '10000', 10),
}
