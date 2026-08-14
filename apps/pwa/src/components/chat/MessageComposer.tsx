import { useState } from 'react'

interface MessageComposerProps {
  disabled?: boolean
  onSend: (text: string) => Promise<void> | void
}

export function MessageComposer({ disabled, onSend }: MessageComposerProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function submit(): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    setSending(true)
    try {
      await onSend(trimmed)
      setText('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderTop: '1px solid #1a2035', background: '#0d1118' }}>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }}
        placeholder="Write a message…"
        rows={2}
        maxLength={5000}
        style={{
          flex: 1, background: '#0B0E14', border: '1px solid #1a2035', borderRadius: 6,
          color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 12,
          padding: '8px 10px', outline: 'none', resize: 'none',
        }}
      />
      <button
        onClick={() => void submit()}
        disabled={disabled || sending || !text.trim()}
        style={{
          alignSelf: 'flex-end', background: disabled || !text.trim() ? '#1a2035' : '#1B5E20',
          border: '1px solid ' + (disabled || !text.trim() ? '#1a2035' : '#4CAF50'),
          borderRadius: 6, color: disabled || !text.trim() ? '#4a5568' : '#4CAF50',
          fontFamily: "'Courier New', monospace", fontSize: 11, padding: '8px 14px', cursor: 'pointer',
        }}
      >
        {sending ? '…' : 'Send'}
      </button>
    </div>
  )
}
