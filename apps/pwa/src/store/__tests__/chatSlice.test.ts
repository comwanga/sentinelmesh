import { describe, expect, test } from 'vitest'
import reducer, {
  channelMessageReceived,
  channelHistoryLoaded,
  channelSynced,
  activeChannelChanged,
  chatReset,
  type ChatMessage,
} from '../chatSlice'

const msg = (id: string, created_at: number): ChatMessage => ({
  id, channel_id: 'ch1', sender_pubkey: 'a'.repeat(64), created_at, content: `msg ${id}`,
})

describe('chatSlice', () => {
  test('appends messages in created_at order and dedupes', () => {
    let state = reducer(undefined, channelMessageReceived({ channel_id: 'ch1', message: msg('m2', 2) }))
    state = reducer(state, channelMessageReceived({ channel_id: 'ch1', message: msg('m1', 1) }))
    state = reducer(state, channelMessageReceived({ channel_id: 'ch1', message: msg('m2', 2) }))
    expect(state.messages['ch1']!.map(m => m.id)).toEqual(['m1', 'm2'])
  })

  test('increments unread only when the channel is not active', () => {
    let state = reducer(undefined, activeChannelChanged('ch1'))
    state = reducer(state, channelMessageReceived({ channel_id: 'ch2', message: msg('m1', 1) }))
    expect(state.unread['ch2']).toBe(1)
    expect(state.unread['ch1']).toBe(0)
  })

  test('history load merges and sorts', () => {
    let state = reducer(undefined, channelMessageReceived({ channel_id: 'ch1', message: msg('m3', 3) }))
    state = reducer(state, channelHistoryLoaded({ channel_id: 'ch1', messages: [msg('m1', 1), msg('m2', 2)] }))
    expect(state.messages['ch1']!.map(m => m.id)).toEqual(['m1', 'm2', 'm3'])
  })

  test('activating a channel clears its unread', () => {
    let state = reducer(undefined, channelMessageReceived({ channel_id: 'ch1', message: msg('m1', 1) }))
    state = reducer(state, channelMessageReceived({ channel_id: 'ch1', message: msg('m2', 2) }))
    expect(state.unread['ch1']).toBe(2)
    state = reducer(state, activeChannelChanged('ch1'))
    expect(state.unread['ch1']).toBe(0)
  })

  test('sync flag and reset', () => {
    let state = reducer(undefined, channelSynced('ch1'))
    expect(state.synced['ch1']).toBe(true)
    state = reducer(state, chatReset())
    expect(state.synced).toEqual({})
    expect(state.messages).toEqual({})
  })
})
