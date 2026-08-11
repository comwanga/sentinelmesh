interface Props {
  activeAlerts: number
}

export function MapStatsBar({ activeAlerts }: Props) {
  return (
    <div style={{
      display: 'flex', alignItems: 'stretch', flexShrink: 0,
      background: '#0B0E14', borderBottom: '1px solid #1a2035',
    }}>
      <div style={statCell}>
        <span style={bigNum}>{activeAlerts}</span>
        <span style={label}>Loaded active alerts</span>
        <span style={sub}>Current session data</span>
      </div>
    </div>
  )
}

const statCell: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', justifyContent: 'center',
  padding: '8px 20px',
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
  fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568',
}
