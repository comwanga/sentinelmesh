// AlertsSheet: mobile bottom sheet that slides up to show live alerts
import { useState } from 'react'
import { useAppSelector } from '../../store'
import { AlertCard, safetyEventToCardProps } from '../shared/AlertCard'

export function AlertsSheet() {
  const [open, setOpen] = useState(false)
  const events = useAppSelector(s => s.events.items)

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      background: '#0B0E14',
      border: '1px solid #1a2035',
      borderBottom: 'none',
      borderRadius: '12px 12px 0 0',
      transition: 'height 0.3s ease',
      height: open ? '60vh' : 44,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Handle strip — tap to toggle */}
      <button
        onClick={() => setOpen(prev => !prev)}
        aria-label={open ? 'Collapse alerts sheet' : 'Expand alerts sheet'}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}
      >
        {/* Drag handle indicator */}
        <div style={{
          width: 36,
          height: 4,
          borderRadius: 2,
          background: '#1a2035',
          margin: '0 auto 0',
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          top: 8,
        }} />

        <span style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 12,
          fontWeight: 700,
          color: '#00E5FF',
          letterSpacing: '0.08em',
          marginTop: 4,
        }}>
          {events.length} ALERTS
        </span>

        <span style={{
          marginLeft: 'auto',
          fontFamily: "'Courier New', monospace",
          fontSize: 12,
          color: '#4a5568',
        }}>
          {open ? '▼' : '▲'}
        </span>
      </button>

      {/* Scrollable alert list — only visible when open */}
      {open && (
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 12px 12px',
        }}>
          {events.length === 0 ? (
            <div style={{
              fontFamily: "'Courier New', monospace",
              fontSize: 12,
              color: '#4a5568',
              textAlign: 'center',
              marginTop: 24,
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
      )}
    </div>
  )
}
