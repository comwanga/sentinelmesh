// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import {
  putConversation,
  listConversations,
  putMessage,
  listMessages,
  markGiftWrapSeen,
  putOutboxItem,
  listPendingOutbox,
  putSyncState,
  getSyncState,
  putReadState,
  getReadState,
  setPreference,
  getPreference,
  encryptLocalPlaintext,
  decryptLocalPlaintext,
} from '../chatStore'

describe('chatStore', () => {
  test('stores and lists conversations', async () => {
    await putConversation({ id: 'conv-1', kind: 'dm', title: 'Alice', muted: false, last_activity_at: 10 })
    const list = await listConversations()
    expect(list).toHaveLength(1)
    expect(list[0]!.title).toBe('Alice')
  })

  test('stores messages and lists them newest-first per conversation', async () => {
    await putMessage({ id: 'm1', conversation_id: 'conv-1', sender_pubkey: 'a'.repeat(64), created_at: 1, kind: 14, ciphertext: 'ct', delivery_state: 'delivered' })
    await putMessage({ id: 'm2', conversation_id: 'conv-1', sender_pubkey: 'b'.repeat(64), created_at: 2, kind: 14, ciphertext: 'ct', delivery_state: 'delivered' })
    await putMessage({ id: 'm3', conversation_id: 'conv-2', sender_pubkey: 'a'.repeat(64), created_at: 3, kind: 14, ciphertext: 'ct', delivery_state: 'delivered' })
    const messages = await listMessages('conv-1')
    expect(messages.map(m => m.id)).toEqual(['m2', 'm1'])
  })

  test('gift-wrap dedup marks each outer id once', async () => {
    expect(await markGiftWrapSeen('wrap-1')).toBe(true)
    expect(await markGiftWrapSeen('wrap-1')).toBe(false)
  })

  test('outbox lists only pending, due items', async () => {
    await putOutboxItem({ id: 'o1', recipient_pubkey: 'a'.repeat(64), relays: ['wss://r'], wrap: '{}', attempts: 0, next_retry_at: 0, delivered: false })
    await putOutboxItem({ id: 'o2', recipient_pubkey: 'b'.repeat(64), relays: ['wss://r'], wrap: '{}', attempts: 0, next_retry_at: 0, delivered: true })
    await putOutboxItem({ id: 'o3', recipient_pubkey: 'c'.repeat(64), relays: ['wss://r'], wrap: '{}', attempts: 0, next_retry_at: Date.now() + 60_000, delivered: false })
    const pending = await listPendingOutbox()
    expect(pending.map(o => o.id)).toEqual(['o1'])
  })

  test('sync and read state round-trip', async () => {
    await putSyncState({ id: 'relay-1', since: 123, eose: true })
    expect((await getSyncState('relay-1'))?.since).toBe(123)

    await putReadState({ conversation_id: 'conv-1', last_read_at: 5, unread: 3 })
    expect((await getReadState('conv-1'))?.unread).toBe(3)
  })

  test('preferences round-trip', async () => {
    await setPreference('blocked', ['a'.repeat(64)])
    expect(await getPreference<string[]>('blocked')).toEqual(['a'.repeat(64)])
  })

  test('local plaintext is encrypted at rest and decrypts back', async () => {
    const ct = await encryptLocalPlaintext('secret message')
    expect(ct).not.toContain('secret')
    expect(await decryptLocalPlaintext(ct)).toBe('secret message')
    expect(await decryptLocalPlaintext('not-base64-$$')).toBeNull()
  })
})
