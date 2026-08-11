import { experimentalFeatures } from '../../config/features'

interface Props {
  onReport: () => void
  onAcoustic: () => void
  onCircles: () => void
  onRoutes: () => void
  onHomeRoute: () => void
}

const cards: { label: string; desc: string; icon: string; key: keyof Props }[] = [
  { label: 'Report Incident',  desc: 'Share what you see. Keep others safe.',          icon: '📢', key: 'onReport' },
  ...(experimentalFeatures.acoustic ? [{ label: 'Acoustic Detect', desc: 'Experimental on-device sound classification.', icon: '🎙', key: 'onAcoustic' as const }] : []),
  ...(experimentalFeatures.circles ? [{ label: 'Family Circles', desc: 'Experimental encrypted location sharing.', icon: '👥', key: 'onCircles' as const }] : []),
  ...(experimentalFeatures.routing ? [
    { label: 'Route Preview', desc: 'Experimental routes around a selected incident.', icon: '🛣', key: 'onRoutes' as const },
    { label: 'Navigate Home', desc: 'Experimental walking directions to a saved location.', icon: '🏠', key: 'onHomeRoute' as const },
  ] : []),
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
