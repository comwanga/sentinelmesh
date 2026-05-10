import { createSelector } from '@reduxjs/toolkit'
import { useAppSelector } from '../store'
import type { RootState } from '../store'
import { AlertCard } from '../components/AlertCard'

const selectActiveEvents = createSelector(
  (state: RootState) => state.events.items,
  items => items.filter(e => e.is_active)
)

export function AlertsPage() {
  const events = useAppSelector(selectActiveEvents)

  return (
    <div
      data-testid="alerts-page"
      style={{
        padding: 24, overflowY: 'auto', height: '100%',
        background: '#0B0E14', fontFamily: 'sans-serif',
      }}
    >
      <h2 style={{ color: '#e2e8f0', margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>
        Active Alerts
        <span style={{ color: '#4a5568', fontWeight: 400, fontSize: 13, marginLeft: 8 }}>
          ({events.length})
        </span>
      </h2>

      {events.length === 0 ? (
        <div style={{ color: '#4a5568', fontSize: 14, textAlign: 'center', paddingTop: 48 }}>
          No active alerts in your area
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {events.map(event => <AlertCard key={event.id} event={event} />)}
        </div>
      )}
    </div>
  )
}
