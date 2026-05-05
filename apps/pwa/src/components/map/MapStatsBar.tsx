interface Props {
  activeAlerts: number
  verified: number
  verifiedPct: number
  communityScore: number
  sources: number
}

export function MapStatsBar({ activeAlerts, verified, verifiedPct, communityScore, sources }: Props) {
  const items = [
    { value: activeAlerts, label: 'Active Alerts', sub: '+6 since 1h' },
    { value: verified, label: 'Verified', sub: `${verifiedPct}% of alerts` },
    { value: communityScore, label: 'Community Score', sub: undefined },
    { value: sources, label: 'Sources', sub: 'NLP + Social + Radio' },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', flexShrink: 0, background: '#0B0E14', borderBottom: '1px solid #1a2035', padding: '8px 0' }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 16px', borderRight: '1px solid #1a2035' }}>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 22, fontWeight: 700, color: '#e2e8f0' }}>{item.value}</span>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568', letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>{item.label}</span>
          {item.sub && <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4CAF50' }}>{item.sub}</span>}
        </div>
      ))}
    </div>
  )
}
