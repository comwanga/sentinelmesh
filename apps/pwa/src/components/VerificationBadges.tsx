interface Props {
  nostrEventId?: string | null
  bitcoinTxid?: string | null
}

const badgeStyle = (bg: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: "'Courier New', monospace",
  fontWeight: 600,
  background: bg,
  color: '#fff',
  textDecoration: 'none',
})

export function VerificationBadges({ nostrEventId, bitcoinTxid }: Props) {
  const network = import.meta.env.VITE_BITCOIN_NETWORK ?? 'testnet'
  const explorerBase = network === 'mainnet'
    ? 'https://mempool.space/tx'
    : 'https://mempool.space/testnet/tx'

  if (!nostrEventId && !bitcoinTxid) return null

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
      {nostrEventId && (
        <a
          href={`https://njump.me/${nostrEventId}`}
          target="_blank"
          rel="noopener noreferrer"
          style={badgeStyle('#6B46C1')}
        >
          ⚡ Nostr
        </a>
      )}
      {bitcoinTxid && (
        <a
          href={`${explorerBase}/${bitcoinTxid}`}
          target="_blank"
          rel="noopener noreferrer"
          style={badgeStyle('#D97706')}
        >
          ₿ Anchored
        </a>
      )}
    </div>
  )
}
