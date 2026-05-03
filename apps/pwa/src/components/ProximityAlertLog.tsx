import type { ProximityAlert, Severity } from '../../../../shared/types'

const SEV_STYLE: Record<Severity, { color: string; border: string; bg: string }> = {
  CRITICAL: { color: '#BB86FC', border: '#BB86FC44', bg: '#BB86FC11' },
  HIGH:     { color: '#BB86FC', border: '#BB86FC44', bg: '#BB86FC11' },
  MEDIUM:   { color: '#f6c90e', border: '#f6c90e44', bg: '#f6c90e11' },
  LOW:      { color: '#4a5568', border: '#2d3748',   bg: 'transparent' },
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  catch { return '--:--' }
}

interface ProximityAlertLogProps {
  alerts: ProximityAlert[]
}

export function ProximityAlertLog({ alerts }: ProximityAlertLogProps) {
  return (
    <div style={{
      height: '25%', flexShrink: 0, borderTop: '1px solid #1a2035',
      background: '#08090f', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 16px', borderBottom: '1px solid #111827', flexShrink: 0,
      }}>
        <span style={{
          fontFamily: "'Courier New', monospace", fontSize: 9,
          letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4a5568',
        }}>
          Proximity Alert Log
        </span>
        {alerts.length > 0 && (
          <span style={{
            background: 'rgba(187,134,252,0.13)', color: '#BB86FC',
            borderRadius: 10, fontSize: 9, padding: '1px 6px',
            fontFamily: "'Courier New', monospace",
          }}>
            {alerts.length} events
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {alerts.length === 0 && (
          <div style={{ padding: '12px 16px', color: '#2d3748', fontSize: 11 }}>
            No proximity alerts
          </div>
        )}
        {alerts.map(alert => {
          const sev = SEV_STYLE[alert.severity]
          const truncated = alert.member_pubkey.length > 10
            ? `${alert.member_pubkey.slice(0, 8)}…`
            : alert.member_pubkey
          return (
            <div key={alert.id} style={{
              display: 'flex', alignItems: 'baseline', gap: 10,
              padding: '5px 16px', borderBottom: '1px solid #0f1420',
            }}>
              <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#2d3748', flexShrink: 0, width: 40 }}>
                {formatTime(alert.triggered_at)}
              </span>
              <span style={{ fontSize: 11, color: '#718096', flex: 1 }}>
                Member{' '}
                <strong style={{ color: '#a0aec0' }}>{truncated}</strong>
                {' '}entered{' '}
                <span style={{ color: '#BB86FC' }}>{alert.zone_name}</span>
              </span>
              <span style={{
                fontFamily: "'Courier New', monospace", fontSize: 9,
                padding: '1px 5px', borderRadius: 3,
                color: sev.color, border: `1px solid ${sev.border}`, background: sev.bg,
                flexShrink: 0,
              }}>
                {alert.severity}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
