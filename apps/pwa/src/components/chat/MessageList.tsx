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

export function MessageList({ messages, emptyText }: { messages: MessageLike[]; emptyText: string }) {
  if (messages.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a5568', fontFamily: "'Courier New', monospace", fontSize: 11, fontStyle: 'italic' }}>
        {emptyText}
      </div>
    )
  }
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
      {messages.map(m => (
        <div key={m.id} style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#BB86FC', marginBottom: 2 }}>
            {senderLabel(m.sender_pubkey)} · {new Date(m.created_at * 1000).toLocaleTimeString()}
          </div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#e2e8f0', lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
            {m.content}
          </div>
        </div>
      ))}
    </div>
  )
}
