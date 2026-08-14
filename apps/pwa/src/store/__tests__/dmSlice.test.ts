import { describe, expect, test } from 'vitest'
import reducer, {
  conversationAdded,
  messageReceived,
  historyLoaded,
  activeConversationChanged,
  dmReset,
  type DmMessage,
} from '../dmSlice'

const msg = (id: string, created_at: number): DmMessage => ({
  id, conversation_id: 'c1', sender_pubkey: 'a'.repeat(64), created_at, content: `msg ${id}`,
})

describe('dmSlice', () => {
  test('adds a conversation once', () => {
    let state = reducer(undefined, conversationAdded({ id: 'c1', kind: 'dm', title: 'A', participants: [] }))
    state = reducer(state, conversationAdded({ id: 'c1', kind: 'dm', title: 'B', participants: [] }))
    expect(state.conversations['c1']!.title).toBe('A')
  })

  test('messages dedupe, sort, and count unread only when inactive', () => {
    let state = reducer(undefined, messageReceived({ conversation_id: 'c1', message: msg('m2', 2) }))
    state = reducer(state, messageReceived({ conversation_id: 'c1', message: msg('m1', 1) }))
    state = reducer(state, messageReceived({ conversation_id: 'c1', message: msg('m2', 2) }))
    expect(state.messages['c1']!.map(m => m.id)).toEqual(['m1', 'm2'])
    expect(state.unread['c1']).toBe(2)

    state = reducer(state, activeConversationChanged('c1'))
    expect(state.unread['c1']).toBe(0)
  })

  test('history load merges and sorts', () => {
    let state = reducer(undefined, messageReceived({ conversation_id: 'c1', message: msg('m3', 3) }))
    state = reducer(state, historyLoaded({ conversation_id: 'c1', messages: [msg('m1', 1), msg('m2', 2)] }))
    expect(state.messages['c1']!.map(m => m.id)).toEqual(['m1', 'm2', 'm3'])
  })

  test('dmReset clears everything', () => {
    let state = reducer(undefined, conversationAdded({ id: 'c1', kind: 'dm', title: 'A', participants: [] }))
    state = reducer(state, messageReceived({ conversation_id: 'c1', message: msg('m1', 1) }))
    state = reducer(state, dmReset())
    expect(state.conversations).toEqual({})
    expect(state.messages).toEqual({})
    expect(state.unread).toEqual({})
  })
})
