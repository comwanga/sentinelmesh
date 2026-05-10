import type { SafetyEvent, Severity } from '../../../../shared/types'

const SEVERITY_COLOURS: Record<Severity, string> = {
  CRITICAL: '#FF2D2D',
  HIGH: '#FF8C00',
  MEDIUM: '#FFD700',
  LOW: '#4CAF50',
}

interface Props {
  event: SafetyEvent
  onClick?: (event: SafetyEvent) => void
}

export function AlertCard({ event, onClick }: Props) {
  const colour = SEVERITY_COLOURS[event.severity]
  return (
    <div
      onClick={() => onClick?.(event)}
      style={{
        background: '#111827', borderRadius: 8, padding: '10px 14px',
        borderLeft: `3px solid ${colour}`, cursor: onClick ? 'pointer' : 'default',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{event.title}</span>
        <span style={{ color: colour, fontSize: 10, fontFamily: "'Courier New', monospace", letterSpacing: '0.05em' }}>
          {event.severity}
        </span>
      </div>
      {event.place_name && (
        <div style={{ color: '#4a5568', fontSize: 11, marginTop: 4 }}>{event.place_name}</div>
      )}
      {event.summary && (
        <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 4 }}>{event.summary}</div>
      )}
    </div>
  )
}
