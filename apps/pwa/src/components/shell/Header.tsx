import { useNavigate } from 'react-router-dom'
import { useAppSelector } from '../../store'

export function Header() {
  const navigate = useNavigate()
  const connected = useAppSelector(s => s.events.connected)
  const activeCount = useAppSelector(s => s.events.items.filter(e => e.is_active).length)

  return (
    <div style={{
      height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12,
      padding: '0 16px', background: '#0B0E14', borderBottom: '1px solid #1a2035',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 28, height: 28, background: '#00E5FF', borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: '#0B0E14',
        }}>S</div>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 14, fontWeight: 700, color: '#e2e8f0', letterSpacing: '0.05em' }}>
          SentinelMesh
        </span>
      </div>

      <input
        style={{
          flex: 1, maxWidth: 320, background: '#0d1118', border: '1px solid #1a2035',
          borderRadius: 8, padding: '6px 12px', color: '#e2e8f0',
          fontFamily: "'Courier New', monospace", fontSize: 12, outline: 'none',
        }}
        placeholder="Search location in Kenya..."
        onKeyDown={e => { if (e.key === 'Enter') navigate('/map') }}
      />

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: '0.1em' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#4CAF50' : '#4a5568' }} />
        <span style={{ color: connected ? '#4CAF50' : '#4a5568' }}>{connected ? 'Live' : 'Offline'}</span>
      </div>

      <span style={{ fontSize: 16 }}>🇰🇪</span>

      <button
        aria-label="notifications"
        style={{ position: 'relative', background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: '#e2e8f0', fontSize: 16 }}
      >
        🔔
        {activeCount > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 0,
            background: '#FF2D2D', color: '#fff', borderRadius: '50%',
            width: 16, height: 16, fontSize: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Courier New', monospace",
          }}>{activeCount}</span>
        )}
      </button>
    </div>
  )
}
