import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store'
import { activeConversationChanged, conversationAdded, messageReceived } from '../store/dmSlice'
import { getNostrSigner } from '../services/signerService'
import { RelayPool } from '../services/relay/relayPool'
import { RelayPoolAdapter } from '../services/relay/relayClient'
import { sendGroupMessage } from '../services/chat/dmSend'
import { roomConversationId } from '../services/chat/dmConversation'
import { circleChatParticipants, circleChatFeasible } from '../services/chat/circleChat'
import { chatRelays } from '../config/chat'
import { MessageList } from '../components/chat/MessageList'
import { MessageComposer } from '../components/chat/MessageComposer'

export function CircleChatPage() {
  const { circleId = '' } = useParams()
  const dispatch = useAppDispatch()
  const circle = useAppSelector(s => s.circles.circles.find(c => c.circle_id === circleId))
  const members = useAppSelector(s => (circleId ? (s.circles.members[circleId] ?? []) : []))
  const [conversationId, setConversationId] = useState<string | null>(null)
  const messages = useAppSelector(s => (conversationId ? (s.dm.messages[conversationId] ?? []) : []))

  useEffect(() => {
    void (async () => {
      const signer = getNostrSigner()
      const pubkey = await signer.pubkey()
      const participants = circleChatParticipants(pubkey, members.map(m => ({ pubkey: m.pubkey ?? '', membership_state: m.membership_state })))
      if (!circleChatFeasible(participants)) { setConversationId(null); return }
      const id = await roomConversationId(participants)
      setConversationId(id)
      dispatch(conversationAdded({ id, kind: 'circle', title: circle?.name ?? 'Circle chat', participants }))
    })()
  }, [circleId, circle?.name, members, dispatch])

  useEffect(() => {
    dispatch(activeConversationChanged(conversationId))
    return () => { dispatch(activeConversationChanged(null)) }
  }, [conversationId, dispatch])

  async function handleSend(text: string): Promise<void> {
    if (!chatRelays.inbox || !conversationId) return
    const signer = getNostrSigner()
    const pubkey = await signer.pubkey()
    const peers = circleChatParticipants(pubkey, members.map(m => ({ pubkey: m.pubkey ?? '', membership_state: m.membership_state }))).filter(p => p !== pubkey.toLowerCase())
    const sent = await sendGroupMessage(signer, peers, text)
    dispatch(messageReceived({
      conversation_id: sent.conversationId,
      message: { id: `pending-${Date.now()}`, conversation_id: sent.conversationId, sender_pubkey: pubkey, created_at: Math.floor(Date.now() / 1000), content: text },
    }))
    const pool = new RelayPool({ signer })
    try {
      const client = new RelayPoolAdapter(pool)
      for (const wrap of sent.wraps) await client.publish([chatRelays.inbox], wrap)
    } finally {
      pool.destroy()
    }
  }

  if (!conversationId) {
    return <div className="feature-notice"><div><h1>Circle chat unavailable</h1><p>Add at least one other active member to enable the Circle chat room.</p></div></div>
  }

  return (
    <div className="bright-feature" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid #1a2035' }}>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#BB86FC', fontWeight: 700 }}>{circle?.name ?? 'Circle chat'}</span>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568' }}>NIP-17 encrypted · room</span>
      </div>
      <MessageList messages={messages} emptyText="No messages yet." />
      <MessageComposer onSend={handleSend} />
    </div>
  )
}
