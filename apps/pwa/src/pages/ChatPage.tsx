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

const sectionLabel: React.CSSProperties = {
  fontFamily: "'Courier New', monospace", fontSize: 9, letterSpacing: '0.14em',
  color: '#4a5568', textTransform: 'uppercase', margin: '0 16px 6px',
}
const input: React.CSSProperties = {
  flex: 1, background: '#0B0E14', border: '1px solid #1a2035', borderRadius: 4,
  color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 12, padding: '8px 10px', outline: 'none',
}
const actionBtn = (disabled = false): React.CSSProperties => ({
  background: disabled ? '#1a2035' : '#1B5E20', border: '1px solid ' + (disabled ? '#1a2035' : '#4CAF50'),
  borderRadius: 4, color: disabled ? '#4a5568' : '#4CAF50', fontFamily: "'Courier New', monospace",
  fontSize: 11, padding: '8px 14px', cursor: disabled ? 'default' : 'pointer',
})
const tile = (accent: string): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
  background: '#0d1118', border: '1px solid #1a2035', borderRadius: 10,
  padding: '11px 13px', cursor: 'pointer', textAlign: 'left', marginBottom: 8,
})
const tileIcon = (color: string): React.CSSProperties => ({
  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 15, background: 'rgba(0,229,255,0.06)', color,
})

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

  const known = joinedIds.map(id => ({ id, name: channels[id]?.name ?? id.slice(0, 12), unread: unread[id] ?? 0 }))
  const dms = Object.values(dmConversations).filter(c => c.kind === 'dm')
  const circles = Object.values(dmConversations).filter(c => c.kind === 'circle')

  return (
    <div className="bright-feature" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="feature-banner">Chat</div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>

        {/* ── Community channels ── */}
        {chatRelays.community && (
          <>
            <p style={sectionLabel}>Community channels</p>
            <div style={{ display: 'flex', gap: 8, margin: '0 0 8px' }}>
              <input value={createName} onChange={e => { setCreateName(e.target.value); setCreateError(null) }} onKeyDown={e => { if (e.key === 'Enter') void handleCreateChannel() }} placeholder="New channel name" style={input} />
              <button onClick={() => void handleCreateChannel()} disabled={creating || !createName.trim()} style={actionBtn(creating || !createName.trim())}>{creating ? '…' : 'Create'}</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input value={joinInput} onChange={e => { setJoinInput(e.target.value); setJoinError(null) }} onKeyDown={e => { if (e.key === 'Enter') handleJoin() }} placeholder="Join by group id or naddr…" style={input} />
              <button onClick={handleJoin} style={actionBtn()}>Join</button>
            </div>
            {createError && <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#FF2D2D', margin: '0 0 8px' }}>{createError}</div>}
            {joinError && <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#FF2D2D', margin: '0 0 8px' }}>{joinError}</div>}
            {known.map(channel => (
              <button key={channel.id} onClick={() => navigate(`/chat/community/${encodeURIComponent(channel.id)}`)} style={tile('#00E5FF')}>
                <span style={tileIcon('#00E5FF')}>#</span>
                <span style={{ flex: 1, fontFamily: "'Courier New', monospace", fontSize: 13, color: '#e2e8f0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{channel.name}</span>
                {channel.unread > 0 && <span style={{ background: '#00E5FF', color: '#0B0E14', borderRadius: 10, padding: '2px 8px', fontFamily: "'Courier New', monospace", fontSize: 10, fontWeight: 700 }}>{channel.unread}</span>}
              </button>
            ))}
            {known.length === 0 && <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568', fontStyle: 'italic', marginBottom: 16 }}>No channels yet — create or join one above.</div>}
          </>
        )}

        {/* ── Personal (inbox) chats ── */}
        {chatRelays.inbox && (
          <>
            <p style={sectionLabel}>Personal chats</p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input value={dmInput} onChange={e => { setDmInput(e.target.value); setDmError(null) }} onKeyDown={e => { if (e.key === 'Enter') void handleNewDm() }} placeholder="Start a chat — npub1… or hex" style={input} />
              <button onClick={() => void handleNewDm()} style={actionBtn()}>Message</button>
            </div>
            {dmError && <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#FF2D2D', margin: '0 0 8px' }}>{dmError}</div>}
            {dms.map(c => (
              <button key={c.id} onClick={() => navigate(`/chat/dm/${c.id}`)} style={tile('#BB86FC')}>
                <span style={tileIcon('#BB86FC')}>@</span>
                <span style={{ flex: 1, fontFamily: "'Courier New', monospace", fontSize: 13, color: '#e2e8f0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                {dmUnread[c.id] ? <span style={{ background: '#BB86FC', color: '#0B0E14', borderRadius: 10, padding: '2px 8px', fontFamily: "'Courier New', monospace", fontSize: 10, fontWeight: 700 }}>{dmUnread[c.id]}</span> : null}
              </button>
            ))}
            {dms.length === 0 && <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568', fontStyle: 'italic', marginBottom: 16 }}>No direct messages yet.</div>}
          </>
        )}

        {/* ── Group (circle) chats ── */}
        <p style={sectionLabel}>Group chats</p>
        {circles.map(c => (
          <button key={c.id} onClick={() => navigate(`/chat/dm/${c.id}`)} style={tile('#4CAF50')}>
            <span style={tileIcon('#4CAF50')}>◐</span>
            <span style={{ flex: 1, fontFamily: "'Courier New', monospace", fontSize: 13, color: '#e2e8f0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
            {dmUnread[c.id] ? <span style={{ background: '#4CAF50', color: '#0B0E14', borderRadius: 10, padding: '2px 8px', fontFamily: "'Courier New', monospace", fontSize: 10, fontWeight: 700 }}>{dmUnread[c.id]}</span> : null}
          </button>
        ))}
        {circles.length === 0 && <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568', fontStyle: 'italic' }}>Open a Family Circle and use its Circle chat to start a group room.</div>}
      </div>
    </div>
  )
}
