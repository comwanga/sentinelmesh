interface Props {
  activeAlerts: number
  verified: number
  verifiedPct: number
  communityScore: number
  sources: number
}

export function MapStatsBar({ activeAlerts, verified, verifiedPct, communityScore, sources }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'stretch', flexShrink: 0,
      background: '#0B0E14', borderBottom: '1px solid #1a2035',
    }}>
      {/* Active Alerts */}
      <div style={statCell}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={bigNum}>{activeAlerts}</span>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#FF2D2D' }}>↑ +6</span>
        </div>
        <span style={label}>Active Alerts</span>
        <span style={sub}>+6 since 1h</span>
      </div>

      {/* Verified */}
      <div style={statCell}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={bigNum}>{verified}</span>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4CAF50' }}>✓</span>
        </div>
        <span style={label}>Verified</span>
        <span style={sub}>{verifiedPct}% of alerts</span>
      </div>

      {/* Community Score */}
      <div style={statCell}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 13, color: '#FFB300' }}>★</span>
          <span style={bigNum}>{communityScore.toFixed(1)}</span>
        </div>
        <span style={label}>Community Score</span>
        <span style={sub}>High trust</span>
      </div>

      {/* Sources */}
      <div style={{ ...statCell, borderRight: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={bigNum}>{sources}</span>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568' }}>◉</span>
        </div>
        <span style={label}>Sources</span>
        <span style={sub}>NLP + Social + Radio</span>
      </div>
    </div>
  )
}

const statCell: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', justifyContent: 'center',
  padding: '8px 20px', borderRight: '1px solid #1a2035',
}

const bigNum: React.CSSProperties = {
  fontFamily: "'Courier New', monospace", fontSize: 22,
  fontWeight: 700, color: '#e2e8f0', lineHeight: 1,
}

const label: React.CSSProperties = {
  fontFamily: "'Courier New', monospace", fontSize: 9,
  color: '#4a5568', letterSpacing: '0.08em',
  textTransform: 'uppercase', marginTop: 2,
}

const sub: React.CSSProperties = {
  fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4CAF50',
}
