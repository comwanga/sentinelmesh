import type { SafetyEvent, Severity } from '../../../../shared/types'

const SEVERITY_COLOURS: Record<Severity, string> = {
  CRITICAL: '#FF2D2D',
  HIGH: '#FF8C00',
  MEDIUM: '#FFD700',
  LOW: '#4CAF50',
}

interface Props {
  events: SafetyEvent[]
}

export function MapStatsBar({ events }: Props) {
  const bySeverity = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Severity[]).map(s => ({
    severity: s,
    count: events.filter(e => e.severity === s).length,
  }))

  return (
    <div style={{
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
      zIndex: 10, display: 'flex', gap: 12, alignItems: 'center',
      background: 'rgba(11,14,20,0.85)', borderRadius: 8, padding: '6px 14px',
      fontFamily: "'Courier New', monospace", fontSize: 11,
    }}>
      <span style={{ color: '#4a5568', marginRight: 4 }}>{events.length} active</span>
      {bySeverity.filter(b => b.count > 0).map(({ severity, count }) => (
        <span key={severity} style={{ color: SEVERITY_COLOURS[severity], display: 'flex', gap: 4 }}>
          <strong>{count}</strong>
          <span style={{ opacity: 0.7 }}>{severity}</span>
        </span>
      ))}
    </div>
  )
}
