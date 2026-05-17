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
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div style={{
          width: 30, height: 30, background: '#00E5FF', borderRadius: 7,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, color: '#0B0E14', fontWeight: 900,
          clipPath: 'polygon(50% 0%, 100% 20%, 100% 70%, 50% 100%, 0% 70%, 0% 20%)',
        }}>⬡</div>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <span style={{
            fontFamily: "'Courier New', monospace", fontSize: 14,
            fontWeight: 700, color: '#e2e8f0', letterSpacing: '0.05em',
          }}>SentinelMesh</span>
          <span style={{
            fontFamily: "'Courier New', monospace", fontSize: 9,
            color: '#4a5568', letterSpacing: '0.04em',
          }}>Safer communities. Zero compromise.</span>
        </div>
      </div>

      {/* Search */}
      <input
        style={{
          flex: 1, maxWidth: 340, background: '#0d1118', border: '1px solid #1a2035',
          borderRadius: 8, padding: '6px 12px', color: '#e2e8f0',
          fontFamily: "'Courier New', monospace", fontSize: 12, outline: 'none',
        }}
        placeholder="Search location in Kenya..."
        onKeyDown={e => { if (e.key === 'Enter') navigate('/map') }}
      />

      <div style={{ flex: 1 }} />

      {/* Live / Offline indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: '0.1em' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#4CAF50' : '#4a5568' }} />
        <span style={{ color: connected ? '#4CAF50' : '#4a5568' }}>{connected ? 'Live' : 'Offline'}</span>
      </div>

      <span style={{ fontSize: 18 }}>🇰🇪</span>

      {/* Filters button */}
      <button
        onClick={() => navigate('/alerts')}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: '#0d1118', border: '1px solid #1a2035',
          borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
          fontFamily: "'Courier New', monospace", fontSize: 11,
          color: '#94a3b8', letterSpacing: '0.06em',
        }}
      >
        <span>⧉</span>
        <span>Filters</span>
      </button>

      {/* Notification bell */}
      <button
        aria-label="notifications"
        style={{
          position: 'relative', background: 'none', border: 'none',
          padding: 4, cursor: 'pointer', color: '#e2e8f0', fontSize: 18,
        }}
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
