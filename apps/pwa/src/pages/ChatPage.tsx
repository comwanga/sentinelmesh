import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store'
import { conversationAdded } from '../store/dmSlice'
import { chatEnabled } from '../config/features'
import { chatRelays } from '../config/chat'
import { getJoinedChannels, addJoinedChannel } from '../services/chat/joinedChannels'
import { parseChannelRef } from '../services/chat/publicChannel'
import { hexFromNpubOrHex } from '../services/nostrService'
import { getNostrSigner } from '../services/signerService'
import { directConversationId } from '../services/chat/dmConversation'
import { createGroupTemplate, newGroupId, setMetadataTemplate } from '../services/chat/nip29'
import { RelayPool } from '../services/relay/relayPool'
import { RelayPoolAdapter } from '../services/relay/relayClient'
import { putConversation, listConversations } from '../services/chat/chatStore'

export function ChatPage() {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const channels = useAppSelector(s => s.chat.channels)
  const unread = useAppSelector(s => s.chat.unread)
  const dmConversations = useAppSelector(s => s.dm.conversations)
  const dmUnread = useAppSelector(s => s.dm.unread)
  const [joinInput, setJoinInput] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)
  const [dmInput, setDmInput] = useState('')
  const [dmError, setDmError] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const joinedIds = getJoinedChannels()

  // Restore persisted DM/circle conversations so the roster (and the npub the
  // user chatted with) survives a refresh.
  useEffect(() => {
    void listConversations().then(stored => {
      for (const c of stored) {
        if ((c.kind === 'dm' || c.kind === 'circle') && c.participants?.length) {
          dispatch(conversationAdded({ id: c.id, kind: c.kind, title: c.title, participants: c.participants }))
        }
      }
    }).catch(() => {})
  }, [dispatch])

  const handleJoin = useCallback(() => {
    const parsed = parseChannelRef(joinInput)
    if (!parsed) { setJoinError('Enter a channel group id or naddr reference.'); return }
    addJoinedChannel(parsed.groupId)
    setJoinError(null)
    setJoinInput('')
    navigate(`/chat/community/${encodeURIComponent(parsed.groupId)}`)
  }, [joinInput, navigate])

  const handleCreateChannel = useCallback(async () => {
    const name = createName.trim()
    const relayUrl = chatRelays.community
    if (!name) { setCreateError('Enter a channel name.'); return }
    if (!relayUrl) { setCreateError('No community relay configured.'); return }
    setCreating(true)
    setCreateError(null)
    try {
      const signer = getNostrSigner()
      const groupId = newGroupId()
      const createEvent = await signer.signEvent(createGroupTemplate(groupId))
      const metadataEvent = await signer.signEvent(setMetadataTemplate(groupId, { name }))
      const pool = new RelayPool({ signer })
      try {
        const client = new RelayPoolAdapter(pool)
        await client.publish([relayUrl], createEvent)
        await client.publish([relayUrl], metadataEvent)
      } finally {
        pool.destroy()
      }
      addJoinedChannel(groupId)
      setCreateName('')
      navigate(`/chat/community/${encodeURIComponent(groupId)}`)
    } catch {
      setCreateError('Could not create the channel.')
    } finally {
      setCreating(false)
    }
  }, [createName, navigate])

  const handleNewDm = useCallback(async () => {
    const hex = hexFromNpubOrHex(dmInput)
    if (!hex) { setDmError('Enter an npub or hex public key.'); return }
    const signer = getNostrSigner()
    const myPubkey = await signer.pubkey()
    const id = await directConversationId(myPubkey, hex)
    const participants = [myPubkey, hex].sort()
    dispatch(conversationAdded({ id, kind: 'dm', title: hex.slice(0, 12), participants }))
    void putConversation({ id, kind: 'dm', title: hex.slice(0, 12), muted: false, last_activity_at: Date.now(), participants })
    setDmError(null)
    setDmInput('')
    navigate(`/chat/dm/${id}`)
  }, [dmInput, dispatch, navigate])

  if (!chatEnabled) {
    return <div className="feature-notice"><div><h1>Chat is disabled</h1><p>Enable VITE_ENABLE_CHAT to use public channels.</p></div></div>
  }

  if (!chatRelays.community && !chatRelays.inbox) {
    return (
      <div className="feature-notice">
        <div>
          <h1 style={{ fontFamily: "'Courier New', monospace", fontSize: 15, color: '#00E5FF', margin: '0 0 10px' }}>Chat is not configured</h1>
          <p style={{ fontFamily: "'Courier New', monospace", fontSize: 11, lineHeight: 1.6, color: '#94a3b8', margin: 0 }}>
            No relay is configured. Set VITE_CHAT_COMMUNITY_RELAY_URL or VITE_CHAT_INBOX_RELAY_URL to enable chat.
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
  const dms = Object.values(dmConversations).filter(c => c.kind === 'dm')
  const circles = Object.values(dmConversations).filter(c => c.kind === 'circle')

  return (
    <div className="bright-feature" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="feature-banner">Chat</div>

      {chatRelays.inbox && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #1a2035' }}>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568', letterSpacing: '0.06em', marginBottom: 6 }}>
            NEW ENCRYPTED MESSAGE
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={dmInput}
              onChange={e => { setDmInput(e.target.value); setDmError(null) }}
              onKeyDown={e => { if (e.key === 'Enter') void handleNewDm() }}
              placeholder="npub1… or hex pubkey"
              style={{ flex: 1, background: '#0B0E14', border: '1px solid #1a2035', borderRadius: 4, color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 12, padding: '8px 10px', outline: 'none' }}
            />
            <button onClick={() => void handleNewDm()} style={{ background: '#1B5E20', border: '1px solid #4CAF50', borderRadius: 4, color: '#4CAF50', fontFamily: "'Courier New', monospace", fontSize: 11, padding: '8px 14px', cursor: 'pointer' }}>
              Message
            </button>
          </div>
          {dmError && <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#FF2D2D', marginTop: 6 }}>{dmError}</div>}
        </div>
      )}

      {chatRelays.community && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #1a2035' }}>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568', letterSpacing: '0.06em', marginBottom: 6 }}>
            CREATE A CHANNEL
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={createName}
              onChange={e => { setCreateName(e.target.value); setCreateError(null) }}
              onKeyDown={e => { if (e.key === 'Enter') void handleCreateChannel() }}
              placeholder="Channel name"
              style={{ flex: 1, background: '#0B0E14', border: '1px solid #1a2035', borderRadius: 4, color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 12, padding: '8px 10px', outline: 'none' }}
            />
            <button onClick={() => void handleCreateChannel()} disabled={creating || !createName.trim()} style={{ background: creating || !createName.trim() ? '#1a2035' : '#1B5E20', border: '1px solid ' + (creating || !createName.trim() ? '#1a2035' : '#4CAF50'), borderRadius: 4, color: creating || !createName.trim() ? '#4a5568' : '#4CAF50', fontFamily: "'Courier New', monospace", fontSize: 11, padding: '8px 14px', cursor: 'pointer' }}>
              {creating ? '…' : 'Create'}
            </button>
          </div>
          {createError && <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#FF2D2D', marginTop: 6 }}>{createError}</div>}

          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#4a5568', letterSpacing: '0.06em', margin: '14px 0 6px' }}>
            OR JOIN A CHANNEL
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={joinInput}
              onChange={e => { setJoinInput(e.target.value); setJoinError(null) }}
              onKeyDown={e => { if (e.key === 'Enter') handleJoin() }}
              placeholder="group id or naddr…"
              style={{ flex: 1, background: '#0B0E14', border: '1px solid #1a2035', borderRadius: 4, color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 12, padding: '8px 10px', outline: 'none' }}
            />
            <button onClick={handleJoin} style={{ background: '#1B5E20', border: '1px solid #4CAF50', borderRadius: 4, color: '#4CAF50', fontFamily: "'Courier New', monospace", fontSize: 11, padding: '8px 14px', cursor: 'pointer' }}>
              Join
            </button>
          </div>
          {joinError && <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#FF2D2D', marginTop: 6 }}>{joinError}</div>}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {dms.length === 0 && circles.length === 0 && known.length === 0 && (
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568', padding: '16px', fontStyle: 'italic' }}>
            No conversations yet.
          </div>
        )}
        {circles.map(c => (
          <button key={c.id} onClick={() => navigate(`/chat/dm/${c.id}`)} style={{ display: 'flex', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', borderBottom: '1px solid #1a2035', padding: '12px 16px', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#e2e8f0' }}>◐ {c.title}</span>
            {dmUnread[c.id] ? <span style={{ background: '#BB86FC', color: '#0B0E14', borderRadius: 10, padding: '1px 8px', fontFamily: "'Courier New', monospace", fontSize: 10 }}>{dmUnread[c.id]}</span> : null}
          </button>
        ))}
        {dms.map(c => (
          <button key={c.id} onClick={() => navigate(`/chat/dm/${c.id}`)} style={{ display: 'flex', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', borderBottom: '1px solid #1a2035', padding: '12px 16px', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#e2e8f0' }}>● {c.title}</span>
            {dmUnread[c.id] ? <span style={{ background: '#BB86FC', color: '#0B0E14', borderRadius: 10, padding: '1px 8px', fontFamily: "'Courier New', monospace", fontSize: 10 }}>{dmUnread[c.id]}</span> : null}
          </button>
        ))}
        {known.map(channel => (
          <button
            key={channel.id}
            onClick={() => navigate(`/chat/community/${encodeURIComponent(channel.id)}`)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', borderBottom: '1px solid #1a2035', padding: '12px 16px', cursor: 'pointer', textAlign: 'left' }}
          >
            <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#e2e8f0' }}># {channel.name}</span>
            {channel.unread > 0 && <span style={{ background: '#00E5FF', color: '#0B0E14', borderRadius: 10, padding: '1px 8px', fontFamily: "'Courier New', monospace", fontSize: 10 }}>{channel.unread}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
