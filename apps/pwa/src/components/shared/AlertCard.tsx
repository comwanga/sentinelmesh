import type { EventType, SafetyEvent, TrustState } from '../../../../../shared/types'
import { Bookmark } from 'lucide-react'
import { trustStateOf, trustStyle } from '../../lib/trust'

export interface AlertCardProps {
  eventId: string
  eventType: EventType
  title: string
  location: string
  timestamp: number
  confidence: number
  rating: number
  status: 'VERIFIED' | 'PENDING'
  trustState: TrustState
  sources: Array<'NLP' | 'Radio' | 'Community' | 'Social'>
  voteCount: number
  onBookmark: (eventId: string) => void
}

const SEVERITY_CONFIDENCE: Record<string, number> = {
  CRITICAL: 0.92,
  HIGH:     0.80,
  MEDIUM:   0.65,
  LOW:      0.45,
}

const SEVERITY_RATING: Record<string, number> = {
  CRITICAL: 4.5,
  HIGH:     4.0,
  MEDIUM:   3.5,
  LOW:      3.0,
}

export function safetyEventToCardProps(
  e: SafetyEvent,
  onBookmark: (id: string) => void = () => {}
): AlertCardProps {
  return {
    eventId:    e.id,
    eventType:  e.event_type,
    title:      e.title,
    location:   e.place_name ?? 'Unknown location',
    timestamp:  new Date(e.created_at).getTime(),
    confidence: SEVERITY_CONFIDENCE[e.severity] ?? 0.5,
    rating:     SEVERITY_RATING[e.severity] ?? 3.0,
    status:     (e.severity === 'CRITICAL' || e.severity === 'HIGH') ? 'VERIFIED' : 'PENDING',
    trustState: trustStateOf(e),
    sources:    inferSources(e.event_type),
    voteCount:  0,
    onBookmark,
  }
}

function inferSources(type: EventType): Array<'NLP' | 'Radio' | 'Community' | 'Social'> {
  switch (type) {
    case 'SECURITY_INCIDENT': return ['NLP', 'Radio']
    case 'CIVIL_UNREST':      return ['NLP', 'Social']
    case 'TRAFFIC_INCIDENT':  return ['Community']
    default:                  return ['NLP']
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

function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating)
  return (
    <span style={{ color: '#FFB300', fontSize: 11, letterSpacing: 1 }}>
      {'★'.repeat(full)}{'☆'.repeat(5 - full)}
      <span style={{ color: '#4a5568', marginLeft: 3 }}>{rating.toFixed(1)}</span>
    </span>
  )
}

export function AlertCard({
  eventId, eventType, title, location, timestamp,
  confidence, rating, status, trustState, sources, voteCount, onBookmark,
}: AlertCardProps) {
  const accent = typeColor[eventType] ?? '#4a5568'
  const pct = Math.round(confidence * 100)
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
        <button
          aria-label="bookmark"
          onClick={() => onBookmark(eventId)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4a5568', padding: 2 }}
        >
          <Bookmark size={14} aria-hidden="true" />
        </button>
      </div>

      {/* Time + confidence */}
      <div style={{
        fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568', marginBottom: 6,
      }}>
        {timeAgo(timestamp)} · {pct}% confidence
      </div>

      {/* Status + rating + sources + votes */}
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
            background: status === 'VERIFIED' ? '#1B5E20' : '#1A237E',
            color: status === 'VERIFIED' ? '#4CAF50' : '#BB86FC',
          }}>
            {status}
          </span>
        )}

        <Stars rating={rating} />

        {sources.map(src => (
          <span key={src} style={{
            fontFamily: "'Courier New', monospace", fontSize: 11, padding: '1px 5px',
            borderRadius: 3, background: '#1a2035', color: '#4a5568',
          }}>{src}</span>
        ))}

        {voteCount > 0 && (
          <span style={{ marginLeft: 'auto', fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568' }}>
            +{voteCount} votes
          </span>
        )}
      </div>
    </div>
  )
}
