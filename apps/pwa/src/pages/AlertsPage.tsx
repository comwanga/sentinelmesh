import { useState, useMemo } from 'react'
import type { EventType } from '../../../../shared/types'
import { useAppSelector } from '../store'
import { selectEventItems } from '../store/eventsSlice'
import { AlertCard, safetyEventToCardProps } from '../components/shared/AlertCard'

const ALL_EVENT_TYPES: EventType[] = [
  'SECURITY_INCIDENT',
  'CIVIL_UNREST',
  'TRAFFIC_INCIDENT',
  'FLOOD',
  'FIRE',
  'MEDICAL_EMERGENCY',
  'INFRASTRUCTURE_FAILURE',
  'FALSE_ALARM',
]

type StatusFilter = 'ALL' | 'VERIFIED' | 'PENDING'
type TimeRange = '1h' | '6h' | '24h' | 'ALL'

const TYPE_LABELS: Record<EventType, string> = {
  SECURITY_INCIDENT:      'Security',
  CIVIL_UNREST:           'Unrest',
  TRAFFIC_INCIDENT:       'Traffic',
  FLOOD:                  'Flood',
  FIRE:                   'Fire',
  MEDICAL_EMERGENCY:      'Medical',
  INFRASTRUCTURE_FAILURE: 'Infra',
  FALSE_ALARM:            'False',
}

const TIME_RANGE_MS: Record<TimeRange, number | null> = {
  '1h':  60 * 60 * 1000,
  '6h':  6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  'ALL': null,
}

export function AlertsPage() {
  const items = useAppSelector(selectEventItems)

  const [selectedTypes, setSelectedTypes] = useState<Set<EventType>>(new Set())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [timeRange, setTimeRange] = useState<TimeRange>('ALL')

  const filtered = useMemo(() => {
    const now = Date.now()
    return items.filter(e => {
      if (selectedTypes.size > 0 && !selectedTypes.has(e.event_type)) return false

      const isVerified = e.severity === 'CRITICAL' || e.severity === 'HIGH'
      if (statusFilter === 'VERIFIED' && !isVerified) return false
      if (statusFilter === 'PENDING' && isVerified) return false

      const rangeMs = TIME_RANGE_MS[timeRange]
      if (rangeMs !== null) {
        const eventTs = new Date(e.created_at).getTime()
        if (now - eventTs > rangeMs) return false
      }

      return true
    })
  }, [items, selectedTypes, statusFilter, timeRange])

  function toggleType(type: EventType) {
    setSelectedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  const filtersActive = selectedTypes.size > 0 || statusFilter !== 'ALL' || timeRange !== 'ALL'

  function handleBookmark(_eventId: string) {
    // TODO: wire to bookmarks slice when implemented
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#0B0E14', overflow: 'hidden',
    }} data-testid="alerts-page">
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px 8px',
        borderBottom: '1px solid #1a2035',
      }}>
        <h1 style={{
          margin: 0, fontFamily: "'Courier New', monospace", fontSize: 15,
          fontWeight: 700, color: '#00E5FF', letterSpacing: '0.1em',
        }}>
          ACTIVE ALERTS
        </h1>
        {filtersActive && (
          <span style={{
            background: '#FF2D2D', color: '#fff', borderRadius: 12,
            fontFamily: "'Courier New', monospace", fontSize: 10,
            padding: '2px 8px', fontWeight: 700, letterSpacing: '0.05em',
          }}>
            {filtered.length} ALERTS
          </span>
        )}
      </div>

      <div style={{
        display: 'flex', gap: 6, padding: '8px 16px',
        overflowX: 'auto', borderBottom: '1px solid #1a2035',
        scrollbarWidth: 'none',
      }}>
        {ALL_EVENT_TYPES.map(type => {
          const active = selectedTypes.has(type)
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              data-testid={`type-chip-${type}`}
              style={{
                flexShrink: 0, border: 'none', borderRadius: 12, cursor: 'pointer',
                fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: '0.05em',
                padding: '4px 8px', whiteSpace: 'nowrap',
                background: active ? '#00E5FF' : '#1a2035',
                color: active ? '#0B0E14' : '#4a5568',
                fontWeight: active ? 700 : 400,
              }}
            >
              {TYPE_LABELS[type]}
            </button>
          )
        })}

        <div style={{ width: 1, background: '#1a2035', flexShrink: 0, margin: '0 4px' }} />

        {(['ALL', 'VERIFIED', 'PENDING'] as StatusFilter[]).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            data-testid={`status-filter-${s}`}
            style={{
              flexShrink: 0, border: 'none', borderRadius: 12, cursor: 'pointer',
              fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: '0.05em',
              padding: '4px 8px',
              background: statusFilter === s ? '#00E5FF' : '#1a2035',
              color: statusFilter === s ? '#0B0E14' : '#4a5568',
              fontWeight: statusFilter === s ? 700 : 400,
            }}
          >
            {s}
          </button>
        ))}

        <div style={{ width: 1, background: '#1a2035', flexShrink: 0, margin: '0 4px' }} />

        {(['1h', '6h', '24h', 'ALL'] as TimeRange[]).map(t => (
          <button
            key={t}
            onClick={() => setTimeRange(t)}
            data-testid={`time-range-${t}`}
            style={{
              flexShrink: 0, border: 'none', borderRadius: 12, cursor: 'pointer',
              fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: '0.05em',
              padding: '4px 8px',
              background: timeRange === t ? '#00E5FF' : '#1a2035',
              color: timeRange === t ? '#0B0E14' : '#4a5568',
              fontWeight: timeRange === t ? 700 : 400,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
        {filtered.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '40px 0',
            fontFamily: "'Courier New', monospace", fontSize: 12, color: '#4a5568',
          }}>
            NO ALERTS MATCH FILTERS
          </div>
        ) : (
          filtered.map(e => (
            <AlertCard
              key={e.id}
              {...safetyEventToCardProps(e, handleBookmark)}
            />
          ))
        )}
      </div>
    </div>
  )
}
