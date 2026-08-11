import type { EventType, SafetyEvent, TrustState } from '../../../../../shared/types'
import { trustStateOf, trustStyle } from '../../lib/trust'

export interface AlertCardProps {
  eventType: EventType
  title: string
  location: string
  timestamp: number
  status: 'CONFIRMED' | 'UNVERIFIED'
  trustState: TrustState
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
  status, trustState,
}: AlertCardProps) {
  const accent = typeColor[eventType] ?? '#4a5568'
  const trust = trustStyle({ trust_state: trustState })

  return (
    <div style={{
      background: '#0d1118', border: '1px solid #1a2035', borderRadius: 8,
      padding: '10px 12px', marginBottom: 8, borderLeft: `3px solid ${accent}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: "'Courier New', monospace", fontSize: 12,
            fontWeight: 700, color: '#e2e8f0', marginBottom: 2,
          }}>
            {title}
          </div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#94a3b8' }}>
            {location}
          </div>
        </div>
      </div>

      <div style={{
        fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568', marginBottom: 6,
      }}>
        {timeAgo(timestamp)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
        {trust.badge ? (
          <span style={{
            fontFamily: "'Courier New', monospace", fontSize: 11, padding: '2px 6px',
            borderRadius: 4, letterSpacing: '0.08em',
            background: '#11151f', color: trust.color, border: `1px solid ${trust.color}`,
          }}>
            {trust.badge}
          </span>
        ) : (
          <span style={{
            fontFamily: "'Courier New', monospace", fontSize: 11, padding: '2px 6px',
            borderRadius: 4, letterSpacing: '0.08em',
            background: status === 'CONFIRMED' ? '#1B5E20' : '#1A237E',
            color: status === 'CONFIRMED' ? '#4CAF50' : '#BB86FC',
          }}>
            {status}
          </span>
        )}

      </div>
    </div>
  )
}
