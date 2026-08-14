import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface ChatMessage {
  id: string
  channel_id: string
  sender_pubkey: string
  created_at: number
  content: string
}

export interface ChatChannelState {
  id: string
  group_id: string
  relay_url: string
  name: string
  about: string
  admins: string[]
  members: string[]
}

interface ChatState {
  channels: Record<string, ChatChannelState>
  messages: Record<string, ChatMessage[]>
  unread: Record<string, number>
  synced: Record<string, boolean>
  activeChannelId: string | null
}

const initialState: ChatState = {
  channels: {},
  messages: {},
  unread: {},
  synced: {},
  activeChannelId: null,
}

function insertSorted(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (messages.some(m => m.id === message.id)) return messages
  const next = [...messages, message]
  next.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1))
  return next
}

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    channelStateLoaded(state, action: PayloadAction<ChatChannelState>) {
      const channel = action.payload
      state.channels[channel.id] = channel
      state.activeChannelId = channel.id
    },
    channelMessageReceived(state, action: PayloadAction<{ channel_id: string; message: ChatMessage }>) {
      const { channel_id, message } = action.payload
      const existing = state.messages[channel_id] ?? []
      const next = insertSorted(existing, message)
      if (next.length !== existing.length) {
        state.messages[channel_id] = next
        if (channel_id !== state.activeChannelId) {
          state.unread[channel_id] = (state.unread[channel_id] ?? 0) + 1
        }
      }
    },
    channelHistoryLoaded(state, action: PayloadAction<{ channel_id: string; messages: ChatMessage[] }>) {
      const { channel_id, messages } = action.payload
      let next = state.messages[channel_id] ?? []
      for (const message of messages) next = insertSorted(next, message)
      state.messages[channel_id] = next
    },
    channelSynced(state, action: PayloadAction<string>) {
      state.synced[action.payload] = true
    },
    channelUnreadCleared(state, action: PayloadAction<string>) {
      state.unread[action.payload] = 0
    },
    activeChannelChanged(state, action: PayloadAction<string | null>) {
      state.activeChannelId = action.payload
      if (action.payload) state.unread[action.payload] = 0
    },
    chatReset(state) {
      state.channels = {}
      state.messages = {}
      state.unread = {}
      state.synced = {}
      state.activeChannelId = null
    },
  },
})

export const {
  channelStateLoaded,
  channelMessageReceived,
  channelHistoryLoaded,
  channelSynced,
  channelUnreadCleared,
  activeChannelChanged,
  chatReset,
} = chatSlice.actions
export default chatSlice.reducer
