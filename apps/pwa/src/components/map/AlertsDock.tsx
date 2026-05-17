import { useNavigate } from 'react-router-dom'
import { useAppSelector } from '../../store'
import { AlertCard, safetyEventToCardProps } from '../shared/AlertCard'

export function AlertsDock() {
  const navigate = useNavigate()
  const events = useAppSelector(s => s.events.items)

  return (
    <div style={{
      width: 320,
      flexShrink: 0,
      background: '#0B0E14',
      borderLeft: '1px solid #1a2035',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 16px 10px',
        borderBottom: '1px solid #1a2035',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
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
        <button
          onClick={() => navigate('/alerts')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: "'Courier New', monospace", fontSize: 10,
            color: '#4a5568', letterSpacing: '0.06em',
            padding: '2px 4px',
          }}
        >
          SEE ALL →
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
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
              key={event.id}
              {...safetyEventToCardProps(event, () => {})}
            />
          ))
        )}
      </div>
    </div>
  )
}
