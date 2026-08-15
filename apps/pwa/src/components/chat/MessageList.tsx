import { toNpub } from '../../services/nostrService'

interface MessageLike {
  id: string
  sender_pubkey: string
  created_at: number
  content: string
}

function senderLabel(pubkey: string): string {
  try {
    return toNpub(pubkey).slice(0, 16) + '…'
  } catch {
    return pubkey.slice(0, 12) + '…'
  }
}

function timeLabel(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MessageList({ messages, emptyText, myPubkey }: { messages: MessageLike[]; emptyText: string; myPubkey?: string }) {
  if (messages.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a5568', fontFamily: "'Courier New', monospace", fontSize: 11, fontStyle: 'italic' }}>
        {emptyText}
      </div>
    )
  }
  const mine = (pubkey: string) => myPubkey ? pubkey.toLowerCase() === myPubkey.toLowerCase() : false
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {messages.map(m => {
        const own = mine(m.sender_pubkey)
        return (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: own ? 'flex-end' : 'flex-start' }}>
            {!own && (
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#BB86FC', letterSpacing: '0.04em', margin: '0 4px 3px' }}>
                {senderLabel(m.sender_pubkey)}
              </div>
            )}
            <div style={{
              maxWidth: '78%',
              padding: '9px 13px',
              borderRadius: own ? '14px 14px 3px 14px' : '14px 14px 14px 3px',
              background: own ? '#0e5e6e' : '#0d1118',
              border: own ? '1px solid #17a2b8' : '1px solid #1a2035',
              boxShadow: own ? '0 6px 16px rgba(14,94,110,0.35)' : 'none',
              color: own ? '#f0fdfa' : '#e2e8f0',
              fontFamily: "'Courier New', monospace",
              fontSize: 13,
              lineHeight: 1.5,
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
            }}>
              {m.content}
            </div>
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568', margin: '3px 4px 0' }}>
              {own ? 'You · ' : ''}{timeLabel(m.created_at)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
