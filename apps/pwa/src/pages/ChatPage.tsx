import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppSelector } from '../store'
import { chatEnabled } from '../config/features'
import { chatRelays } from '../config/chat'
import { getJoinedChannels, addJoinedChannel } from '../services/chat/joinedChannels'
import { parseChannelRef } from '../services/chat/publicChannel'

export function ChatPage() {
  const navigate = useNavigate()
  const channels = useAppSelector(s => s.chat.channels)
  const unread = useAppSelector(s => s.chat.unread)
  const [joinInput, setJoinInput] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)

  const joinedIds = getJoinedChannels()

  const handleJoin = useCallback(() => {
    const parsed = parseChannelRef(joinInput)
    if (!parsed) { setJoinError('Enter a channel group id or naddr reference.'); return }
    addJoinedChannel(parsed.groupId)
    setJoinError(null)
    setJoinInput('')
    navigate(`/chat/community/${encodeURIComponent(parsed.groupId)}`)
  }, [joinInput, navigate])

  if (!chatEnabled) {
    return <div className="feature-notice"><div><h1>Chat is disabled</h1><p>Enable VITE_ENABLE_CHAT to use public channels.</p></div></div>
  }

  if (!chatRelays.community) {
    return (
      <div className="feature-notice">
        <div>
          <h1 style={{ fontFamily: "'Courier New', monospace", fontSize: 15, color: '#00E5FF', margin: '0 0 10px' }}>Chat is not configured</h1>
          <p style={{ fontFamily: "'Courier New', monospace", fontSize: 11, lineHeight: 1.6, color: '#94a3b8', margin: 0 }}>
            No community relay is configured. Set VITE_CHAT_COMMUNITY_RELAY_URL to enable public channels.
          </p>
        </div>
      </div>
    )
  }

  const known = joinedIds.map(id => ({
    id,
    name: channels[id]?.name ?? id.slice(0, 12),
    unread: unread[id] ?? 0,
  }))

  return (
    <div className="bright-feature" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="feature-banner">Public channels</div>

      <div style={{ padding: '12px 16px', borderBottom: '1px solid #1a2035' }}>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568', letterSpacing: '0.06em', marginBottom: 6 }}>
          JOIN A CHANNEL
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={joinInput}
            onChange={e => { setJoinInput(e.target.value); setJoinError(null) }}
            onKeyDown={e => { if (e.key === 'Enter') handleJoin() }}
            placeholder="group id or naddr…"
            style={{
              flex: 1, background: '#0B0E14', border: '1px solid #1a2035', borderRadius: 4,
              color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 12, padding: '8px 10px', outline: 'none',
            }}
          />
          <button onClick={handleJoin} style={{ background: '#1B5E20', border: '1px solid #4CAF50', borderRadius: 4, color: '#4CAF50', fontFamily: "'Courier New', monospace", fontSize: 11, padding: '8px 14px', cursor: 'pointer' }}>
            Join
          </button>
        </div>
        {joinError && <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#FF2D2D', marginTop: 6 }}>{joinError}</div>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {known.length === 0 && (
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568', padding: '16px', fontStyle: 'italic' }}>
            No channels joined yet — enter a group id above.
          </div>
        )}
        {known.map(channel => (
          <button
            key={channel.id}
            onClick={() => navigate(`/chat/community/${encodeURIComponent(channel.id)}`)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
              background: 'none', border: 'none', borderBottom: '1px solid #1a2035',
              padding: '12px 16px', cursor: 'pointer', textAlign: 'left',
            }}
          >
            <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#e2e8f0' }}># {channel.name}</span>
            {channel.unread > 0 && <span style={{ background: '#00E5FF', color: '#0B0E14', borderRadius: 10, padding: '1px 8px', fontFamily: "'Courier New', monospace", fontSize: 10 }}>{channel.unread}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
