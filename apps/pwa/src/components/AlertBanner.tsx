import type { ProximityAlert } from '../../../../shared/types'

interface AlertBannerProps {
  alert: ProximityAlert | null
  onDismiss: () => void
}

export function AlertBanner({ alert, onDismiss }: AlertBannerProps) {
  if (!alert) return null

  const truncated = alert.member_pubkey.length > 10
    ? `${alert.member_pubkey.slice(0, 8)}…`
    : alert.member_pubkey

  return (
    <div style={{
      background: 'linear-gradient(90deg, rgba(0,229,255,0.07), rgba(187,134,252,0.07))',
      borderBottom: '1px solid rgba(0,229,255,0.25)',
      padding: '8px 16px',
      display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%', background: '#00E5FF',
        boxShadow: '0 0 8px #00E5FF', flexShrink: 0,
        animation: 'alert-pulse 1.2s ease-in-out infinite',
      }} />
      <style>{`
        @keyframes alert-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.7); }
        }
      `}</style>
      <span style={{
        fontFamily: "'Courier New', monospace", fontSize: 11,
        color: '#00E5FF', letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>
        Proximity Alert
      </span>
      <span style={{ color: '#a0aec0', fontSize: 12 }}>
        Member{' '}
        <strong style={{ color: '#e2e8f0' }}>{truncated}</strong>
        {' '}has entered{' '}
        <strong style={{ color: '#BB86FC' }}>{alert.zone_name}</strong>
      </span>
      <button
        onClick={onDismiss}
        style={{
          marginLeft: 'auto', background: 'none', border: 'none',
          color: '#4a5568', fontSize: 18, cursor: 'pointer', lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )
}
