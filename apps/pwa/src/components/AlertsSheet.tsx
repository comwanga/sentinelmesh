import { AlertCard } from './AlertCard'
import type { SafetyEvent } from '../../../../shared/types'

interface Props {
  events: SafetyEvent[]
  open: boolean
  onClose: () => void
  onSelect: (event: SafetyEvent) => void
}

export function AlertsSheet({ events, open, onClose, onSelect }: Props) {
  if (!open) return null

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
      background: '#0B0E14', borderTop: '1px solid #1a2035', borderRadius: '16px 16px 0 0',
      maxHeight: '60vh', overflow: 'auto', padding: '16px 12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ color: '#e2e8f0', fontSize: 14, fontFamily: 'sans-serif', fontWeight: 600 }}>
          Active Alerts
        </span>
        <button onClick={onClose} aria-label="Close alerts" style={{ background: 'none', border: 'none', color: '#4a5568', cursor: 'pointer', fontSize: 18 }}>
          ×
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {events.map(event => (
          <AlertCard key={event.id} event={event} onClick={(e) => { onSelect(e); onClose() }} />
        ))}
        {events.length === 0 && (
          <div style={{ color: '#4a5568', fontSize: 13, fontFamily: 'sans-serif', textAlign: 'center', padding: 24 }}>
            No active alerts
          </div>
        )}
      </div>
    </div>
  )
}
