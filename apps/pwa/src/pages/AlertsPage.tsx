import { useState, useMemo } from 'react'
import type { EventType } from '../../../../shared/types'
import { useAppSelector } from '../store'
import { selectEventItems } from '../store/eventsSlice'
import { AlertCard, safetyEventToCardProps } from '../components/shared/AlertCard'
import { trustStateOf } from '../lib/trust'

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

type StatusFilter = 'ALL' | 'CONFIRMED' | 'UNVERIFIED'
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

      const isConfirmed = trustStateOf(e) === 'confirmed'
      if (statusFilter === 'CONFIRMED' && !isConfirmed) return false
      if (statusFilter === 'UNVERIFIED' && isConfirmed) return false

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

  return (
    <div className="page" data-testid="alerts-page">
      <div className="page-header">
        <h1>Community alerts
        {filtersActive && (
          <span className="count-badge">
            {filtered.length} alerts
          </span>
        )}
        </h1>
        <p>Review active incidents, evidence status, and recent community updates.</p>
      </div>

      <div className="filter-bar">
        {ALL_EVENT_TYPES.map(type => {
          const active = selectedTypes.has(type)
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              data-testid={`type-chip-${type}`}
              className={active ? 'active' : ''}
            >
              {TYPE_LABELS[type]}
            </button>
          )
        })}

        <div className="filter-divider" />

        {(['ALL', 'CONFIRMED', 'UNVERIFIED'] as StatusFilter[]).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            data-testid={`status-filter-${s}`}
            className={statusFilter === s ? 'active' : ''}
          >
            {s}
          </button>
        ))}

        <div className="filter-divider" />

        {(['1h', '6h', '24h', 'ALL'] as TimeRange[]).map(t => (
          <button
            key={t}
            onClick={() => setTimeRange(t)}
            data-testid={`time-range-${t}`}
            className={timeRange === t ? 'active' : ''}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="page-content">
        {filtered.length === 0 ? (
          <div className="empty-state">
            No alerts match these filters.
          </div>
        ) : (
          filtered.map(e => (
            <AlertCard
              key={e.id}
              {...safetyEventToCardProps(e)}
            />
          ))
        )}
      </div>
    </div>
  )
}
