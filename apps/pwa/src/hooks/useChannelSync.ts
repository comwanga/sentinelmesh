import { useEffect, useRef } from 'react'
import { useAppDispatch } from '../store'
import {
  channelStateLoaded,
  channelMessageReceived,
  channelHistoryLoaded,
  channelSynced,
  type ChatMessage,
} from '../store/chatSlice'
import { getNostrSigner } from '../services/signerService'
import { RelayPool } from '../services/relay/relayPool'
import { RelayPoolAdapter } from '../services/relay/relayClient'
import { fetchRelayInfo } from '../services/relay/relayConnection'
import { loadChannelState } from '../services/chat/publicChannel'
import { subscribeChannel, fetchChannelHistory, resumeSince } from '../services/chat/chatSync'
import { channelConversationId } from '../services/chat/conversationId'
import type { Event } from 'nostr-tools'

export interface ChannelRef {
  relayUrl: string
  groupId: string
}

export function useChannelSync(ref: ChannelRef | null): void {
  const dispatch = useAppDispatch()
  const closerRef = useRef<{ close(): void } | null>(null)

  useEffect(() => {
    if (!ref) return
    const { relayUrl, groupId } = ref
    const channelId = channelConversationId(relayUrl, groupId)
    let disposed = false
    const seen = new Set<string>()

    let pool: RelayPool | null = null
    const subs: { close(): void }[] = []

    function toChatMessage(event: Event): ChatMessage {
      return { id: event.id, channel_id: channelId, sender_pubkey: event.pubkey, created_at: event.created_at, content: event.content }
    }

    async function run(): Promise<void> {
      try {
        const signer = getNostrSigner()
        pool = new RelayPool({ signer })
        const client = new RelayPoolAdapter(pool)

        // Load relay self key for NIP-29 state verification (best effort).
        let relaySelfPubkey: string | null = null
        try {
          relaySelfPubkey = (await fetchRelayInfo(relayUrl)).pubkey ?? null
        } catch { /* NIP-11 unavailable — state events still signature-checked */ }

        void loadChannelState(client, relayUrl, groupId, relaySelfPubkey).then(state => {
          if (!disposed) dispatch(channelStateLoaded({ id: channelId, group_id: groupId, relay_url: relayUrl, name: state.name, about: state.about, admins: state.admins, members: state.members }))
        }).catch(() => {})

        // Bounded history first, then live subscription from the overlap cursor.
        const history = await fetchChannelHistory(client, relayUrl, groupId)
        if (disposed) return
        for (const event of history) seen.add(event.id)
        dispatch(channelHistoryLoaded({ channel_id: channelId, messages: history.map(toChatMessage) }))

        const last = history[history.length - 1]?.created_at
        const sub = subscribeChannel(client, relayUrl, groupId, {
          seen,
          since: last ? resumeSince(last) : undefined,
          onEvent: (event) => dispatch(channelMessageReceived({ channel_id: channelId, message: toChatMessage(event) })),
          onEose: () => dispatch(channelSynced(channelId)),
        })
        if (disposed) { sub.close(); return }
        subs.push(sub)
      } catch {
        // Relay unreachable — the UI shows the unconfigured/unavailable state.
      }
    }

    void run()

    return () => {
      disposed = true
      for (const sub of subs) sub.close()
      closerRef.current?.close()
      if (pool) pool.destroy()
    }
  }, [dispatch, ref?.relayUrl, ref?.groupId])
}
