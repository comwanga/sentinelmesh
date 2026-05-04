interface InviteModalProps {
  isOpen: boolean
  inviteString: string
  onClose: () => void
}

export function InviteModal({ isOpen, inviteString, onClose }: InviteModalProps) {
  if (!isOpen) return null

  function copyToClipboard() {
    navigator.clipboard.writeText(inviteString).catch(() => {})
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: 'rgba(5,7,9,0.85)', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#0d1118', border: '1px solid #1a2035', borderRadius: 8,
        padding: 24, width: 440, maxWidth: '90vw',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#BB86FC' }}>
            Invite via Nostr
          </span>
          <button
            aria-label="close"
            onClick={onClose}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#4a5568', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <p style={{ fontSize: 12, color: '#718096', marginBottom: 12 }}>
          Share this invite string with the person you want to add. It expires in 24 hours.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            readOnly
            value={inviteString}
            style={{
              flex: 1, background: '#050709', border: '1px solid #1a2035', borderRadius: 4,
              padding: '8px 10px', color: '#a0aec0', fontFamily: "'Courier New', monospace", fontSize: 11,
              outline: 'none',
            }}
          />
          <button
            onClick={copyToClipboard}
            style={{
              background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.3)',
              borderRadius: 4, padding: '8px 14px', color: '#00E5FF',
              fontFamily: "'Courier New', monospace", fontSize: 11, cursor: 'pointer',
              letterSpacing: '0.05em',
            }}
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  )
}
