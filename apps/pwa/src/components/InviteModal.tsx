import { useState } from 'react'

interface InviteModalProps {
  isOpen: boolean
  inviteString: string
  onClose: () => void
}

export function InviteModal({ isOpen, inviteString, onClose }: InviteModalProps) {
  const [copied, setCopied] = useState(false)

  if (!isOpen) return null

  function copy() {
    navigator.clipboard.writeText(inviteString).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }).catch(() => {})
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(5,7,9,0.88)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#0d1118', border: '1px solid #1a2035', borderRadius: 10,
        padding: 24, width: 480, maxWidth: '100%',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 13, letterSpacing: '0.1em', color: '#00E5FF', fontWeight: 700 }}>
            Invite to Circle
          </span>
          <button
            aria-label="close"
            onClick={onClose}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#4a5568', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* Instructions */}
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568', lineHeight: 1.6, marginBottom: 14 }}>
          Share this invite code with the person you want to add. They paste it in the <strong style={{ color: '#94a3b8' }}>Join Circle</strong> tab to see their public key, then share it back with you so you can add them.
        </div>

        {/* Invite string */}
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568', marginBottom: 4, letterSpacing: '0.06em' }}>
          INVITE CODE
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            readOnly
            value={inviteString}
            onClick={e => (e.target as HTMLInputElement).select()}
            style={{
              flex: 1, background: '#050709', border: '1px solid #1a2035', borderRadius: 6,
              padding: '9px 10px', color: '#a0aec0', fontFamily: "'Courier New', monospace", fontSize: 10,
              outline: 'none', wordBreak: 'break-all',
            }}
          />
          <button
            onClick={copy}
            style={{
              flexShrink: 0,
              background: copied ? '#1B5E20' : 'rgba(0,229,255,0.1)',
              border: '1px solid ' + (copied ? '#4CAF50' : 'rgba(0,229,255,0.3)'),
              borderRadius: 6, padding: '8px 16px',
              color: copied ? '#4CAF50' : '#00E5FF',
              fontFamily: "'Courier New', monospace", fontSize: 11, cursor: 'pointer',
              letterSpacing: '0.05em',
            }}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>

        {/* Step-by-step guide */}
        <div style={{ background: '#050709', border: '1px solid #1a2035', borderRadius: 6, padding: '10px 14px' }}>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568', marginBottom: 8, letterSpacing: '0.08em' }}>
            HOW TO ADD SOMEONE
          </div>
          {[
            'Send them the invite code above',
            'They open SentinelMesh → Family Circles → Join Circle',
            'They paste the code and copy their public key',
            'They share their key with you',
            'You paste their key in "Add Member by Key" in the sidebar',
          ].map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 5 }}>
              <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#00E5FF', flexShrink: 0 }}>
                {i + 1}.
              </span>
              <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#718096', lineHeight: 1.5 }}>
                {step}
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: 14, width: '100%',
            background: 'none', border: '1px solid #1a2035', borderRadius: 6,
            color: '#4a5568', fontFamily: "'Courier New', monospace", fontSize: 11,
            padding: '8px 0', cursor: 'pointer',
          }}
        >
          Done
        </button>
      </div>
    </div>
  )
}
