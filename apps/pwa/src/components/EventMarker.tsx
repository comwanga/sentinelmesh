import type { SafetyEvent, Severity, EventType } from '../../../../shared/types'

const SEVERITY_COLOURS: Record<Severity, string> = {
  CRITICAL: '#FF2D2D',
  HIGH:     '#FF8C00',
  MEDIUM:   '#FFD700',
  LOW:      '#4CAF50',
}

const EVENT_ICONS: Record<EventType, string> = {
  FLOOD:                  '🌊',
  SECURITY_INCIDENT:      '🔴',
  FIRE:                   '🔥',
  TRAFFIC_INCIDENT:       '🚧',
  CIVIL_UNREST:           '⚠️',
  INFRASTRUCTURE_FAILURE: '⚡',
  MEDICAL_EMERGENCY:      '🏥',
  FALSE_ALARM:            '✅',
}

interface Props {
  event: SafetyEvent
  onClick: (event: SafetyEvent) => void
}

export default function EventMarker({ event, onClick }: Props) {
  const colour = SEVERITY_COLOURS[event.severity]
  const icon = EVENT_ICONS[event.event_type] ?? '⚠️'

  return (
    <div
      onClick={() => onClick(event)}
      style={{
        background: colour,
        borderRadius: '50%',
        width: 36,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        border: '2px solid white',
        fontSize: 16,
        boxShadow: `0 0 0 4px ${colour}44`,
      }}
      title={event.title}
    >
      {icon}
    </div>
  )
}
