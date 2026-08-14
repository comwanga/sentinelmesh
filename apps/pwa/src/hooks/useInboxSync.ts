import { useEffect } from 'react'
import { useAppDispatch } from '../store'
import { conversationAdded, messageReceived } from '../store/dmSlice'
import { getNostrSigner } from '../services/signerService'
import { RelayPool } from '../services/relay/relayPool'
import { RelayPoolAdapter } from '../services/relay/relayClient'
import { inboxFilter, processGiftWrap } from '../services/chat/inbox'
import { encryptLocalPlaintext, hasGiftWrap, markGiftWrapSeen, putMessage } from '../services/chat/chatStore'
import { chatRelays } from '../config/chat'

export function useInboxSync(enabled: boolean): void {
  const dispatch = useAppDispatch()

  useEffect(() => {
    if (!enabled || !chatRelays.inbox) return
    let disposed = false
    let pool: RelayPool | null = null
    let closer: { close(): void } | null = null

    async function run(): Promise<void> {
      try {
        const signer = getNostrSigner()
        const pubkey = await signer.pubkey()
        pool = new RelayPool({ signer })
        const client = new RelayPoolAdapter(pool)

        const seen = new Set<string>()
        const sub = client.subscribe([chatRelays.inbox!], inboxFilter(pubkey), (wrap) => {
          void (async () => {
            const isSeen = async (id: string) => seen.has(id) || (await hasGiftWrap(id))
            const markSeen = async (id: string) => { seen.add(id); await markGiftWrapSeen(id) }
            const processed = await processGiftWrap(signer, wrap, isSeen, markSeen)
            if (!processed || disposed) return
            const encrypted = await encryptLocalPlaintext(processed.content)
            await putMessage({
              id: processed.rumorId,
              conversation_id: processed.conversationId,
              sender_pubkey: processed.senderPubkey,
              created_at: processed.created_at,
              kind: 14,
              ciphertext: encrypted,
              delivery_state: 'delivered',
            })
            dispatch(conversationAdded({
              id: processed.conversationId,
              kind: processed.participants.length === 2 ? 'dm' : 'circle',
              title: processed.senderPubkey.slice(0, 12),
              participants: processed.participants,
            }))
            dispatch(messageReceived({
              conversation_id: processed.conversationId,
              message: { id: processed.rumorId, conversation_id: processed.conversationId, sender_pubkey: processed.senderPubkey, created_at: processed.created_at, content: processed.content },
            }))
          })()
        }, () => {})
        if (disposed) { sub.close(); return }
        closer = sub
      } catch {
        // Inbox relay unreachable — chat stays silent.
      }
    }

    void run()

    return () => {
      disposed = true
      closer?.close()
      if (pool) pool.destroy()
    }
  }, [dispatch, enabled])
}
