import type { EventType, SafetyEvent, TrustState } from '../../../../../shared/types'
import { trustStateOf, trustStyle } from '../../lib/trust'

export interface AlertCardProps {
  eventType: EventType
  title: string
  location: string
  timestamp: number
  status: 'CONFIRMED' | 'UNVERIFIED'
  trustState: TrustState
  severity?: string
  onClick?: () => void
  selected?: boolean
}

export function safetyEventToCardProps(
  e: SafetyEvent,
): AlertCardProps {
  const trustState = trustStateOf(e)
  return {
    eventType:  e.event_type,
    title:      e.title,
    location:   e.place_name ?? 'Unknown location',
    timestamp:  new Date(e.created_at).getTime(),
    status:     trustState === 'confirmed' ? 'CONFIRMED' : 'UNVERIFIED',
    trustState,
    severity: e.severity,
  }
}

const typeColor: Record<EventType, string> = {
  SECURITY_INCIDENT:      '#FF2D2D',
  CIVIL_UNREST:           '#FF9800',
  TRAFFIC_INCIDENT:       '#2196F3',
  FLOOD:                  '#00BCD4',
  FIRE:                   '#FF5722',
  MEDICAL_EMERGENCY:      '#E91E63',
  INFRASTRUCTURE_FAILURE: '#9C27B0',
  FALSE_ALARM:            '#4a5568',
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  return `${Math.floor(m / 60)}h ago`
}

export function AlertCard({
  eventType, title, location, timestamp,
  status, trustState, severity, onClick, selected,
}: AlertCardProps) {
  const accent = typeColor[eventType] ?? '#4a5568'
  const trust = trustStyle({ trust_state: trustState })

  return (
    <button type="button" onClick={onClick} className={`atlas-alert-card ${selected ? 'selected' : ''}`} style={{
      background: '#fff', border: '1px solid #d9e1dc', borderRadius: 13,
      padding: '12px 13px', marginBottom: 9, borderLeft: `4px solid ${accent}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 13, fontWeight: 800, color: '#183330', marginBottom: 3,
          }}>
            {title}
          </div>
          <div style={{ fontSize: 11, color: '#48635e' }}>
            {location} {severity ? `· ${severity}` : ''}
          </div>
        </div>
      </div>

      <div style={{
        fontSize: 10, color: '#687c78', marginBottom: 7,
      }}>
        {timeAgo(timestamp)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
        {trust.badge ? (
          <span style={{
            fontSize: 9, fontWeight: 800, padding: '3px 7px',
            borderRadius: 10, letterSpacing: '0.05em',
            background: '#f7f8f3', color: trust.color, border: `1px solid ${trust.color}`,
          }}>
            {trust.badge}
          </span>
        ) : (
          <span style={{
            fontSize: 9, fontWeight: 800, padding: '3px 7px',
            borderRadius: 10, letterSpacing: '0.05em',
            background: status === 'CONFIRMED' ? '#dff3e8' : '#e8eff8',
            color: status === 'CONFIRMED' ? '#25845b' : '#42658b',
          }}>
            {status}
          </span>
        )}

      </div>
    </button>
  )
}
