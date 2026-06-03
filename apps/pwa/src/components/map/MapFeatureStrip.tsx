interface Props {
  onReport: () => void
  onAcoustic: () => void
  onCircles: () => void
  onRoutes: () => void
  onHomeRoute: () => void
}

const cards: { label: string; desc: string; icon: string; key: keyof Props }[] = [
  { label: 'Report Incident',  desc: 'Share what you see. Keep others safe.',          icon: '📢', key: 'onReport' },
  { label: 'Acoustic Detect',  desc: 'Listen for gunshots, explosions, screams.',       icon: '🎙', key: 'onAcoustic' },
  { label: 'Family Circles',   desc: 'Share location with trusted family.',             icon: '👥', key: 'onCircles' },
  { label: 'Escape Routes',    desc: 'Get 2–3 safe routes away from danger.',           icon: '🛣', key: 'onRoutes' },
  { label: 'Navigate Home',    desc: 'Safest walking route to your home address.',      icon: '🏠', key: 'onHomeRoute' },
]

export function MapFeatureStrip(props: Props) {
  return (
    <div style={{
      display: 'flex', gap: 8, padding: '8px 12px',
      background: '#0B0E14', borderTop: '1px solid #1a2035', flexShrink: 0,
    }}>
      {cards.map(c => (
        <button
          key={c.key}
          onClick={props[c.key]}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
            gap: 4, padding: '10px 12px',
            background: '#0d1118', border: '1px solid #1a2035', borderRadius: 8,
            cursor: 'pointer', textAlign: 'left',
            transition: 'border-color 150ms',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = '#2d3748')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = '#1a2035')}
        >
          <span style={{ fontSize: 20 }}>{c.icon}</span>
          <span style={{
            fontFamily: "'Courier New', monospace", fontSize: 11,
            fontWeight: 700, color: '#e2e8f0', letterSpacing: '0.04em',
          }}>
            {c.label}
          </span>
          <span style={{
            fontFamily: "'Courier New', monospace", fontSize: 9,
            color: '#4a5568', lineHeight: 1.4,
          }}>
            {c.desc}
          </span>
        </button>
      ))}
    </div>
  )
}
