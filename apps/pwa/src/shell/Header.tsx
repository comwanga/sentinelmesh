import { useAppSelector } from '../store'

export function Header() {
  const connected = useAppSelector(s => s.events.connected)
  return (
    <div style={{
      height: 40, background: '#0B0E14', borderBottom: '1px solid #1a2035',
      display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8, flexShrink: 0,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: connected ? '#4CAF50' : '#FF2D2D',
      }} />
      <span style={{ color: '#4a5568', fontSize: 11, fontFamily: "'Courier New', monospace", letterSpacing: '0.1em' }}>
        SENTINELMESH
      </span>
    </div>
  )
}
