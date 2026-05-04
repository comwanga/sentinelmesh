export function X25519Badge() {
  return (
    <div style={{
      position: 'absolute', bottom: 12, right: 12,
      display: 'flex', alignItems: 'center', gap: 6,
      background: 'rgba(5, 14, 20, 0.85)',
      border: '1px solid rgba(0, 229, 255, 0.3)',
      borderRadius: 6, padding: '5px 10px',
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%', background: '#00E5FF',
        animation: 'x25519-pulse 2s ease-in-out infinite',
      }} />
      <style>{`
        @keyframes x25519-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0,229,255,0.4); }
          50% { box-shadow: 0 0 0 5px rgba(0,229,255,0); }
        }
      `}</style>
      <span style={{
        fontFamily: "'Courier New', monospace", fontSize: 10,
        color: '#00E5FF', letterSpacing: '0.1em', textTransform: 'uppercase',
      }}>
        X25519 Active
      </span>
    </div>
  )
}
