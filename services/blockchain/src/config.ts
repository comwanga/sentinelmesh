export const config = {
  port: parseInt(process.env.BLOCKCHAIN_PORT ?? '3003', 10),
  databaseUrl: process.env.DATABASE_URL ?? '',
  nostrPrivkey: process.env.NOSTR_PRIVKEY ?? '',
  relayUrls: (process.env.RELAY_URLS ?? 'wss://relay.damus.io').split(',').map(s => s.trim()),
  bitcoinWif: process.env.BITCOIN_WIF ?? '',
  bitcoinNetwork: (process.env.BITCOIN_NETWORK ?? 'testnet') as 'mainnet' | 'testnet',
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '10000', 10),
}
