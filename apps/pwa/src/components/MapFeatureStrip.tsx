import type { Severity } from '../../../../shared/types'

const SEVERITY_COLOURS: Record<Severity, string> = {
  CRITICAL: '#FF2D2D',
  HIGH: '#FF8C00',
  MEDIUM: '#FFD700',
  LOW: '#4CAF50',
}

const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

interface Props {
  active: Set<Severity>
  onToggle: (s: Severity) => void
}

export function MapFeatureStrip({ active, onToggle }: Props) {
  return (
    <div style={{
      position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
      zIndex: 10, display: 'flex', gap: 8,
    }}>
      {SEVERITIES.map(s => (
        <button
          key={s}
          onClick={() => onToggle(s)}
          style={{
            background: active.has(s) ? SEVERITY_COLOURS[s] : 'rgba(11,14,20,0.85)',
            color: active.has(s) ? '#000' : SEVERITY_COLOURS[s],
            border: `1px solid ${SEVERITY_COLOURS[s]}`,
            borderRadius: 4, padding: '4px 10px',
            fontFamily: "'Courier New', monospace", fontSize: 10, cursor: 'pointer',
            letterSpacing: '0.05em',
          }}
        >
          {s}
        </button>
      ))}
    </div>
  )
}
