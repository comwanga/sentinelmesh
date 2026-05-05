import type { EventType, SafetyEvent } from '../../../../../shared/types'

export interface AlertCardProps {
  eventId: string
  eventType: EventType
  title: string
  location: string
  timestamp: number
  confidence: number
  status: 'VERIFIED' | 'PENDING'
  sources: Array<'NLP' | 'Radio' | 'Community' | 'Social'>
  voteCount: number
  onBookmark: (eventId: string) => void
}

// Shared mapping helper — single source of truth used by AlertsDock, AlertsSheet, AlertsPage
export function safetyEventToCardProps(
  e: SafetyEvent,
  onBookmark: (id: string) => void = () => {}
): AlertCardProps {
  return {
    eventId:    e.event_id,
    eventType:  e.event_type,
    title:      e.title,
    location:   e.location?.place_name ?? 'Unknown location',
    timestamp:  new Date(e.last_updated).getTime(),
    confidence: e.confidence,
    status:     e.confidence >= 0.7 ? 'VERIFIED' : 'PENDING',
    sources:    Object.keys(e.source_breakdown) as Array<'NLP' | 'Radio' | 'Community' | 'Social'>,
    voteCount:  e.source_count,
    onBookmark,
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
  eventId, eventType, title, location, timestamp,
  confidence, status, sources, voteCount, onBookmark,
}: AlertCardProps) {
  const accent = typeColor[eventType] ?? '#4a5568'
  const pct = Math.round(confidence * 100)

  return (
    <div style={{
      background: '#0d1118', border: '1px solid #1a2035', borderRadius: 8,
      padding: '10px 12px', marginBottom: 8, borderLeft: `3px solid ${accent}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 2 }}>
            {title}
          </div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568' }}>
            {location}
          </div>
        </div>
        <button
          aria-label="bookmark"
          onClick={() => onBookmark(eventId)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4a5568', fontSize: 14, padding: 2 }}
        >
          🔖
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
        <span style={{
          fontFamily: "'Courier New', monospace", fontSize: 9, padding: '2px 6px',
          borderRadius: 4, letterSpacing: '0.08em',
          background: status === 'VERIFIED' ? '#1B5E20' : '#1A237E',
          color: status === 'VERIFIED' ? '#4CAF50' : '#BB86FC',
        }}>{status}</span>

        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568' }}>
          {pct}%
        </span>

        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568' }}>
          {timeAgo(timestamp)}
        </span>

        {sources.map(src => (
          <span key={src} style={{
            fontFamily: "'Courier New', monospace", fontSize: 9, padding: '1px 5px',
            borderRadius: 3, background: '#1a2035', color: '#4a5568',
          }}>{src}</span>
        ))}

        <span style={{ marginLeft: 'auto', fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568' }}>
          {voteCount} votes
        </span>
      </div>
    </div>
  )
}
