import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store'
import { activeChannelChanged, channelMessageReceived } from '../store/chatSlice'
import { chatEnabled } from '../config/features'
import { chatRelays } from '../config/chat'
import { useChannelSync } from '../hooks/useChannelSync'
import { getNostrSigner } from '../services/signerService'
import { RelayPool } from '../services/relay/relayPool'
import { RelayPoolAdapter } from '../services/relay/relayClient'
import { createChannelMessage, signChannelMessage } from '../services/chat/nip29'
import { publishChannelMessage } from '../services/chat/publicChannel'
import { channelConversationId } from '../services/chat/conversationId'
import { putChannelMessage } from '../services/chat/chatStore'
import { useActiveIdentity } from '../hooks/useActiveIdentity'
import { MessageList } from '../components/chat/MessageList'
import { MessageComposer } from '../components/chat/MessageComposer'

export function PublicChannelPage() {
  const { groupId = '' } = useParams()
  const dispatch = useAppDispatch()
  const { pubkey: myPubkey } = useActiveIdentity()
  const relayUrl = chatRelays.community
  const channelId = relayUrl ? channelConversationId(relayUrl, groupId) : ''
  const channel = useAppSelector(s => (channelId ? s.chat.channels[channelId] : undefined))
  const messages = useAppSelector(s => (channelId ? (s.chat.messages[channelId] ?? []) : []))

  useChannelSync(relayUrl && chatEnabled ? { relayUrl, groupId } : null)

  useEffect(() => {
    dispatch(activeChannelChanged(channelId || null))
    return () => { dispatch(activeChannelChanged(null)) }
  }, [channelId, dispatch])

  async function handleSend(text: string): Promise<void> {
    if (!relayUrl) return
    const signer = getNostrSigner()
    const pubkey = await signer.pubkey()
    const message = createChannelMessage(pubkey, groupId, text)
    const event = await signChannelMessage(signer, message)
    const channel_id = channelConversationId(relayUrl, groupId)
    // Optimistic local echo + durable persistence so the message survives refresh.
    void putChannelMessage({ id: event.id, channel_id, sender_pubkey: pubkey, created_at: event.created_at, content: text })
    dispatch(channelMessageReceived({
      channel_id,
      message: { id: event.id, channel_id, sender_pubkey: pubkey, created_at: event.created_at, content: text },
    }))
    const pool = new RelayPool({ signer })
    try {
      await publishChannelMessage(new RelayPoolAdapter(pool), relayUrl, event)
    } finally {
      pool.destroy()
    }
  }

  if (!chatEnabled || !relayUrl) {
    return <div className="feature-notice"><div><h1>Chat is not configured</h1><p>Set VITE_CHAT_COMMUNITY_RELAY_URL to use public channels.</p></div></div>
  }

  return (
    <div className="bright-feature" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid #1a2035' }}>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#00E5FF', fontWeight: 700 }}># {channel?.name ?? groupId.slice(0, 12)}</span>
        {channel && <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568' }}>{channel.members.length} members</span>}
      </div>
      <MessageList messages={messages} emptyText="No messages yet — say hello." myPubkey={myPubkey} />
      <MessageComposer onSend={handleSend} />
    </div>
  )
}
