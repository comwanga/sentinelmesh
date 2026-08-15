import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store'
import { activeConversationChanged, conversationAdded, messageReceived } from '../store/dmSlice'
import { getNostrSigner } from '../services/signerService'
import { RelayPool } from '../services/relay/relayPool'
import { RelayPoolAdapter } from '../services/relay/relayClient'
import { sendDirectMessage } from '../services/chat/dmSend'
import { chatRelays } from '../config/chat'
import { useActiveIdentity } from '../hooks/useActiveIdentity'
import { MessageList } from '../components/chat/MessageList'
import { MessageComposer } from '../components/chat/MessageComposer'

export function DirectConversationPage() {
  const { conversationId = '' } = useParams()
  const dispatch = useAppDispatch()
  const { pubkey: myPubkey } = useActiveIdentity()
  const conversation = useAppSelector(s => s.dm.conversations[conversationId])
  const messages = useAppSelector(s => (conversationId ? (s.dm.messages[conversationId] ?? []) : []))

  useEffect(() => {
    dispatch(activeConversationChanged(conversationId || null))
    return () => { dispatch(activeConversationChanged(null)) }
  }, [conversationId, dispatch])

  async function handleSend(text: string): Promise<void> {
    if (!chatRelays.inbox || !conversation) return
    const signer = getNostrSigner()
    const myPubkey = await signer.pubkey()
    const recipient = conversation.participants.find(p => p !== myPubkey.toLowerCase())
    if (!recipient) return
    const sent = await sendDirectMessage(signer, recipient, text)
    // Optimistic local echo.
    dispatch(messageReceived({
      conversation_id: sent.conversationId,
      message: { id: `pending-${Date.now()}`, conversation_id: sent.conversationId, sender_pubkey: myPubkey, created_at: Math.floor(Date.now() / 1000), content: text },
    }))
    const pool = new RelayPool({ signer })
    try {
      await new RelayPoolAdapter(pool).publish([chatRelays.inbox], sent.wraps.find(w => w.tags.some(t => t[0] === 'p' && t[1] === recipient)) ?? sent.wraps[0]!)
    } finally {
      pool.destroy()
    }
  }

  if (!conversation) {
    return <div className="feature-notice"><div><h1>Conversation not found</h1><p>Start a new direct message from the chat page.</p></div></div>
  }

  return (
    <div className="bright-feature" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid #1a2035' }}>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#BB86FC', fontWeight: 700 }}>{conversation.title}</span>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568' }}>NIP-17 encrypted</span>
      </div>
      <MessageList messages={messages} emptyText="No messages yet." myPubkey={myPubkey} />
      <MessageComposer onSend={handleSend} />
    </div>
  )
}
