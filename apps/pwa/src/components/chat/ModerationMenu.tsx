import { useState } from 'react'
import type { EventTemplate } from 'nostr-tools'
import { removeUserTemplate } from '../../services/chat/nip29'

interface ModerationMenuProps {
  groupId: string
  admins: string[]
  myPubkey: string
  onAction: (template: EventTemplate, kind: number) => Promise<void> | void
}

export function ModerationMenu({ groupId, admins, myPubkey, onAction }: ModerationMenuProps) {
  const [removeInput, setRemoveInput] = useState('')
  const [busy, setBusy] = useState(false)

  const isAdmin = admins.some(a => a.toLowerCase() === myPubkey.toLowerCase())
  if (!isAdmin) return null

  async function handleRemoveUser(): Promise<void> {
    const pubkey = removeInput.trim()
    if (!/^[0-9a-f]{64}$/i.test(pubkey)) return
    setBusy(true)
    try {
      await onAction(removeUserTemplate(groupId, pubkey), 9001)
      setRemoveInput('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: '8px 16px', borderBottom: '1px solid #1a2035', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568', letterSpacing: '0.06em' }}>
        MODERATE
      </span>
      <input
        value={removeInput}
        onChange={e => setRemoveInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') void handleRemoveUser() }}
        placeholder="pubkey to remove"
        style={{
          flex: 1, minWidth: 180, background: '#0B0E14', border: '1px solid #1a2035', borderRadius: 4,
          color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 11, padding: '6px 8px', outline: 'none',
        }}
      />
      <button
        onClick={() => void handleRemoveUser()}
        disabled={busy}
        style={{
          background: '#3b1212', border: '1px solid #FC8686', borderRadius: 4, color: '#FC8686',
          fontFamily: "'Courier New', monospace", fontSize: 10, padding: '6px 10px', cursor: 'pointer',
        }}
      >
        Remove member
      </button>
    </div>
  )
}
