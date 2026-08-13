const DB_NAME = 'sentinelmesh-remote-signer'
const STORE = 'state'
const WRAP_KEY_ID = 'wrap-key'
const CONNECTION_ID = 'connection'

export interface StoredBunkerConnection {
  clientSecretKey: Uint8Array
  bunkerPubkey: string
  relays: string[]
  secret: string | null
  expectedPubkey: string
}

interface EncryptedRecord { iv: Uint8Array; ciphertext: Uint8Array }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function get<T>(id: string): Promise<T | null> {
  return openDb().then(db => new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
    request.onsuccess = () => { db.close(); resolve((request.result as T | undefined) ?? null) }
    request.onerror = () => { db.close(); reject(request.error) }
  }))
}

function put(id: string, value: unknown): Promise<void> {
  return openDb().then(db => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(value, id)
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onerror = () => { db.close(); reject(transaction.error) }
  }))
}

function remove(id: string): Promise<void> {
  return openDb().then(db => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).delete(id)
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onerror = () => { db.close(); reject(transaction.error) }
  }))
}

async function wrapKey(): Promise<CryptoKey> {
  const existing = await get<CryptoKey>(WRAP_KEY_ID)
  if (existing) return existing
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await put(WRAP_KEY_ID, key)
  return key
}

function encode(value: StoredBunkerConnection): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    ...value,
    clientSecretKey: btoa(String.fromCharCode(...value.clientSecretKey)),
  }))
}

function decode(bytes: Uint8Array): StoredBunkerConnection {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as Omit<StoredBunkerConnection, 'clientSecretKey'> & { clientSecretKey: string }
  return {
    ...value,
    clientSecretKey: Uint8Array.from(atob(value.clientSecretKey), char => char.charCodeAt(0)),
  }
}

export async function saveBunkerConnection(value: StoredBunkerConnection): Promise<void> {
  const key = await wrapKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encode(value)
  try {
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, plaintext as unknown as BufferSource,
    ))
    await put(CONNECTION_ID, { iv, ciphertext } satisfies EncryptedRecord)
  } finally {
    plaintext.fill(0)
  }
}

export async function loadBunkerConnection(): Promise<StoredBunkerConnection | null> {
  try {
    const key = await get<CryptoKey>(WRAP_KEY_ID)
    const record = await get<EncryptedRecord>(CONNECTION_ID)
    if (!key || !record) return null
    const plaintext = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv as unknown as BufferSource }, key, record.ciphertext as unknown as BufferSource,
    ))
    try { return decode(plaintext) } finally { plaintext.fill(0) }
  } catch {
    return null
  }
}

export async function clearBunkerConnection(): Promise<void> {
  await remove(CONNECTION_ID)
}
