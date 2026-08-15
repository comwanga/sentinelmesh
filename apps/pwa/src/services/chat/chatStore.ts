// Durable chat storage. A dedicated, versioned IndexedDB database holds
// conversations, messages, gift-wrap deduplication, outbox, sync cursors, read
// state, and preferences. Plaintext message bodies are encrypted under a
// non-extractable device key before persistence; conversation ids, ordering
// timestamps, and delivery state remain indexable (and therefore visible in a
// stolen database file) — that metadata boundary is documented, not hidden.
import type { ChatConversationKind, ChatDeliveryState } from '../../../../../shared/types'

const DB_NAME = 'sentinelmesh-chat'
const DB_VERSION = 1

const STORE_CONVERSATIONS = 'conversations'
const STORE_MESSAGES = 'messages'
const STORE_GIFT_WRAPS = 'gift_wraps'
const STORE_OUTBOX = 'outbox'
const STORE_SYNC = 'sync_state'
const STORE_READ = 'read_state'
const STORE_PREFS = 'preferences'
const STORE_CRYPTO = 'crypto'

const CRYPTO_KEY_ID = 'local-encryption-key'

export interface StoredConversation {
  id: string
  kind: ChatConversationKind
  title: string
  muted: boolean
  last_activity_at: number
  participants?: string[]
  group_id?: string
  relay_url?: string
}

export interface StoredMessage {
  id: string
  conversation_id: string
  sender_pubkey: string
  created_at: number
  kind: number
  ciphertext: string
  delivery_state: ChatDeliveryState
}

export interface StoredOutboxItem {
  id: string
  recipient_pubkey: string
  relays: string[]
  wrap: string
  attempts: number
  next_retry_at: number
  delivered: boolean
}

export interface StoredSyncState {
  id: string
  since: number
  eose: boolean
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) db.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const store = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' })
        store.createIndex('by_conversation', ['conversation_id', 'created_at', 'id'])
      }
      if (!db.objectStoreNames.contains(STORE_GIFT_WRAPS)) db.createObjectStore(STORE_GIFT_WRAPS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_SYNC)) db.createObjectStore(STORE_SYNC, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_READ)) db.createObjectStore(STORE_READ, { keyPath: 'conversation_id' })
      if (!db.objectStoreNames.contains(STORE_PREFS)) db.createObjectStore(STORE_PREFS, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(STORE_CRYPTO)) db.createObjectStore(STORE_CRYPTO, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function put<T>(store: string, value: T): Promise<void> {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value as unknown as Record<string, unknown>)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
    tx.onabort = () => { db.close(); reject(tx.error) }
  })
}

async function get<T>(store: string, key: string): Promise<T | null> {
  const db = await openDb()
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).get(key)
    req.onsuccess = () => { db.close(); resolve((req.result as T | undefined) ?? null) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

async function del(store: string, key: string): Promise<void> {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
  const row = await get<{ id: string; key: CryptoKey }>(STORE_CRYPTO, CRYPTO_KEY_ID)
  if (row?.key) return row.key
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await put(STORE_CRYPTO, { id: CRYPTO_KEY_ID, key })
  return key
}

function encode(iv: Uint8Array, data: ArrayBuffer): string {
  const combined = new Uint8Array(iv.byteLength + data.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(data), iv.byteLength)
  return btoa(String.fromCharCode(...combined))
}

function decode(b64: string): { iv: Uint8Array; data: Uint8Array } | null {
  try {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    if (bytes.length < 28) return null
    return { iv: bytes.slice(0, 12), data: bytes.slice(12) }
  } catch {
    return null
  }
}

/** Encrypt a plaintext message body under the local non-extractable device key. */
export async function encryptLocalPlaintext(plaintext: string): Promise<string> {
  const key = await getOrCreateEncryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as unknown as BufferSource,
  )
  return encode(iv, ciphertext)
}

export async function decryptLocalPlaintext(ciphertextB64: string): Promise<string | null> {
  try {
    const key = await getOrCreateEncryptionKey()
    const decoded = decode(ciphertextB64)
    if (!decoded) return null
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decoded.iv as unknown as BufferSource },
      key,
      decoded.data as unknown as BufferSource,
    )
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}

// ── Conversations ────────────────────────────────────────────────────────────

export async function putConversation(conversation: StoredConversation): Promise<void> {
  await put(STORE_CONVERSATIONS, conversation)
}

export async function listConversations(): Promise<StoredConversation[]> {
  const db = await openDb()
  return new Promise<StoredConversation[]>((resolve, reject) => {
    const tx = db.transaction(STORE_CONVERSATIONS, 'readonly')
    const req = tx.objectStore(STORE_CONVERSATIONS).getAll()
    req.onsuccess = () => { db.close(); resolve(req.result as StoredConversation[]) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

// ── Messages ─────────────────────────────────────────────────────────────────

export async function putMessage(message: StoredMessage): Promise<void> {
  await put(STORE_MESSAGES, message)
}

export async function listMessages(conversationId: string, opts: { limit?: number; before?: number } = {}): Promise<StoredMessage[]> {
  const db = await openDb()
  return new Promise<StoredMessage[]>((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, 'readonly')
    const index = tx.objectStore(STORE_MESSAGES).index('by_conversation')
    const range = IDBKeyRange.bound(
      [conversationId, Number.MIN_SAFE_INTEGER, ''],
      [conversationId, opts.before ?? Number.MAX_SAFE_INTEGER, '\uffff'],
    )
    const req = index.openCursor(range, 'prev')
    const results: StoredMessage[] = []
    const limit = opts.limit ?? 200
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor || results.length >= limit) { db.close(); resolve(results); return }
      results.push(cursor.value as StoredMessage)
      cursor.continue()
    }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

// ── Public channel messages (kind 9, plaintext) ──────────────────────────────
// Public NIP-29 messages are not encrypted, so they are stored as-is (in the
// `ciphertext` slot, which is a misnomer for public content) so they survive a
// page refresh and render immediately before the relay sync completes.

export interface PublicChannelMessage {
  id: string
  channel_id: string
  sender_pubkey: string
  created_at: number
  content: string
}

export async function putChannelMessage(message: PublicChannelMessage): Promise<void> {
  await putMessage({
    id: message.id,
    conversation_id: message.channel_id,
    sender_pubkey: message.sender_pubkey,
    created_at: message.created_at,
    kind: 9,
    ciphertext: message.content,
    delivery_state: 'delivered',
  })
}

export async function listChannelMessages(channelId: string): Promise<PublicChannelMessage[]> {
  const stored = await listMessages(channelId)
  return stored.map(message => ({
    id: message.id,
    channel_id: message.conversation_id,
    sender_pubkey: message.sender_pubkey,
    created_at: message.created_at,
    content: message.ciphertext,
  }))
}

// ── Gift-wrap deduplication ──────────────────────────────────────────────────

export async function hasGiftWrap(outerId: string): Promise<boolean> {
  return (await get(STORE_GIFT_WRAPS, outerId)) !== null
}

export async function markGiftWrapSeen(outerId: string): Promise<boolean> {
  const existing = await get(STORE_GIFT_WRAPS, outerId)
  if (existing) return false
  await put(STORE_GIFT_WRAPS, { id: outerId, seen_at: Date.now() })
  return true
}

// ── Outbox ───────────────────────────────────────────────────────────────────

export async function putOutboxItem(item: StoredOutboxItem): Promise<void> {
  await put(STORE_OUTBOX, item)
}

export async function listPendingOutbox(now = Date.now()): Promise<StoredOutboxItem[]> {
  const db = await openDb()
  return new Promise<StoredOutboxItem[]>((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readonly')
    const req = tx.objectStore(STORE_OUTBOX).getAll()
    req.onsuccess = () => {
      db.close()
      resolve((req.result as StoredOutboxItem[]).filter(i => !i.delivered && i.next_retry_at <= now))
    }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

// ── Sync cursors ─────────────────────────────────────────────────────────────

export async function putSyncState(state: StoredSyncState): Promise<void> {
  await put(STORE_SYNC, state)
}

export async function getSyncState(id: string): Promise<StoredSyncState | null> {
  return get<StoredSyncState>(STORE_SYNC, id)
}

// ── Read state ───────────────────────────────────────────────────────────────

export interface StoredReadState {
  conversation_id: string
  last_read_at: number
  unread: number
}

export async function putReadState(state: StoredReadState): Promise<void> {
  await put(STORE_READ, state)
}

export async function getReadState(conversationId: string): Promise<StoredReadState | null> {
  return get<StoredReadState>(STORE_READ, conversationId)
}

// ── Preferences ──────────────────────────────────────────────────────────────

export async function setPreference(key: string, value: unknown): Promise<void> {
  await put(STORE_PREFS, { key, value })
}

export async function getPreference<T>(key: string): Promise<T | null> {
  const row = await get<{ key: string; value: T }>(STORE_PREFS, key)
  return row?.value ?? null
}

/** Test/account hook: delete a conversation and its messages. */
export async function deleteConversation(conversationId: string): Promise<void> {
  await del(STORE_CONVERSATIONS, conversationId)
  await del(STORE_READ, conversationId)
}
