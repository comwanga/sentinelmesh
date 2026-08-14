import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export type DmConversationKind = 'dm' | 'circle'

export interface DmConversation {
  id: string
  kind: DmConversationKind
  title: string
  participants: string[]
}

export interface DmMessage {
  id: string
  conversation_id: string
  sender_pubkey: string
  created_at: number
  content: string
}

interface DmState {
  conversations: Record<string, DmConversation>
  messages: Record<string, DmMessage[]>
  unread: Record<string, number>
  activeConversationId: string | null
}

const initialState: DmState = {
  conversations: {},
  messages: {},
  unread: {},
  activeConversationId: null,
}

function insertSorted(messages: DmMessage[], message: DmMessage): DmMessage[] {
  if (messages.some(m => m.id === message.id)) return messages
  const next = [...messages, message]
  next.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1))
  return next
}

const dmSlice = createSlice({
  name: 'dm',
  initialState,
  reducers: {
    conversationAdded(state, action: PayloadAction<DmConversation>) {
      const conversation = action.payload
      if (!state.conversations[conversation.id]) state.conversations[conversation.id] = conversation
    },
    messageReceived(state, action: PayloadAction<{ conversation_id: string; message: DmMessage }>) {
      const { conversation_id, message } = action.payload
      const existing = state.messages[conversation_id] ?? []
      const next = insertSorted(existing, message)
      if (next.length !== existing.length) {
        state.messages[conversation_id] = next
        if (conversation_id !== state.activeConversationId) {
          state.unread[conversation_id] = (state.unread[conversation_id] ?? 0) + 1
        }
      }
    },
    historyLoaded(state, action: PayloadAction<{ conversation_id: string; messages: DmMessage[] }>) {
      const { conversation_id, messages } = action.payload
      let next = state.messages[conversation_id] ?? []
      for (const message of messages) next = insertSorted(next, message)
      state.messages[conversation_id] = next
    },
    activeConversationChanged(state, action: PayloadAction<string | null>) {
      state.activeConversationId = action.payload
      if (action.payload) state.unread[action.payload] = 0
    },
    dmReset(state) {
      state.conversations = {}
      state.messages = {}
      state.unread = {}
      state.activeConversationId = null
    },
  },
})

export const {
  conversationAdded,
  messageReceived,
  historyLoaded,
  activeConversationChanged,
  dmReset,
} = dmSlice.actions
export default dmSlice.reducer
