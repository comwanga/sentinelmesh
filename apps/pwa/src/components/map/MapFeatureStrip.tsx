interface Props {
  onReport: () => void
  onAcoustic: () => void
  onCircles: () => void
  onRoutes: () => void
  onZaps: () => void
}

const cards: { label: string; icon: string; key: keyof Props }[] = [
  { label: 'Report Incident',  icon: '📢', key: 'onReport' },
  { label: 'Acoustic Detect',  icon: '🎙', key: 'onAcoustic' },
  { label: 'Family Circles',   icon: '👥', key: 'onCircles' },
  { label: 'Escape Routes',    icon: '🛣', key: 'onRoutes' },
  { label: 'Zap Reporter',     icon: '⚡', key: 'onZaps' },
]

export function MapFeatureStrip(props: Props) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '8px 12px', background: '#0B0E14', borderTop: '1px solid #1a2035', flexShrink: 0 }}>
      {cards.map(c => (
        <button key={c.key} onClick={props[c.key]} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 4px', background: '#0d1118', border: '1px solid #1a2035', borderRadius: 8, cursor: 'pointer', color: '#e2e8f0' }}>
          <span style={{ fontSize: 20 }}>{c.icon}</span>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, letterSpacing: '0.06em', color: '#4a5568', textAlign: 'center' as const }}>{c.label}</span>
        </button>
      ))}
    </div>
  )
}
