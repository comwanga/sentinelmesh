// AlertsDock: desktop right panel showing live alerts in a fixed 320px column
import { useAppSelector } from '../../store'
import { AlertCard, safetyEventToCardProps } from '../shared/AlertCard'

export function AlertsDock() {
  const events = useAppSelector(s => s.events.items)

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      width: 320,
      height: '100%',
      background: '#0B0E14',
      borderLeft: '1px solid #1a2035',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 100,
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px 10px',
        borderBottom: '1px solid #1a2035',
        flexShrink: 0,
      }}>
        <span style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 13,
          fontWeight: 700,
          color: '#00E5FF',
          letterSpacing: '0.1em',
        }}>
          LIVE ALERTS
        </span>
      </div>

      {/* Scrollable alert list */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '10px 12px',
      }}>
        {events.length === 0 ? (
          <div style={{
            fontFamily: "'Courier New', monospace",
            fontSize: 12,
            color: '#4a5568',
            textAlign: 'center',
            marginTop: 32,
          }}>
            No active alerts
          </div>
        ) : (
          events.map(event => (
            <AlertCard
              key={event.event_id}
              {...safetyEventToCardProps(event, () => {})}
            />
          ))
        )}
      </div>
    </div>
  )
}
