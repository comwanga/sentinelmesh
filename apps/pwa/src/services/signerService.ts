import { finalizeEvent, generateSecretKey, verifyEvent, type EventTemplate, type VerifiedEvent } from 'nostr-tools'
import { BunkerSigner, type BunkerPointer } from 'nostr-tools/nip46'
import { SimplePool } from 'nostr-tools/pool'
import { getCachedKeypair } from './nostrService'
import { clearBunkerConnection, loadBunkerConnection, saveBunkerConnection, type StoredBunkerConnection } from './bunkerStore'

export type SignerMode = 'local' | 'bunker'
export type SignerStatus = 'ready' | 'connecting' | 'offline' | 'authorization-required' | 'error'
export interface ActiveIdentity { mode: SignerMode; pubkey: string; status: SignerStatus; approvalUrl?: string; error?: string }

let identity: ActiveIdentity = { mode: 'local', pubkey: '', status: 'ready' }
let remote: { signer: BunkerSigner; pool: SimplePool; generation: number } | null = null
let generation = 0
const listeners = new Set<(value: ActiveIdentity) => void>()

function publish(next: ActiveIdentity): void {
  identity = next
  listeners.forEach(listener => listener({ ...next }))
}

export function getActiveIdentity(): ActiveIdentity {
  return identity
}

export function subscribeActiveIdentity(listener: (value: ActiveIdentity) => void): () => void {
  listeners.add(listener)
  listener(getActiveIdentity())
  return () => listeners.delete(listener)
}

export async function initializeActiveSigner(): Promise<void> {
  const stored = await loadBunkerConnection()
  if (stored) publish({ mode: 'bunker', pubkey: stored.expectedPubkey, status: 'offline' })
  else publish({ mode: 'local', pubkey: getCachedKeypair().publicKey, status: 'ready' })
}

export function refreshLocalIdentity(): void {
  if (identity.mode === 'local') publish({ mode: 'local', pubkey: getCachedKeypair().publicKey, status: 'ready' })
}

function parsePointer(input: string): BunkerPointer {
  if (input.length > 2048 || !input.startsWith('bunker://')) throw new Error('Enter a bunker:// connection URI')
  const url = new URL(input)
  if (url.username || url.password || url.port || (url.pathname && url.pathname !== '/') || url.hash) {
    throw new Error('Bunker URI contains unsupported components')
  }
  for (const key of url.searchParams.keys()) {
    if (key !== 'relay' && key !== 'secret') throw new Error(`Bunker URI contains unsupported parameter: ${key}`)
  }
  if (url.searchParams.getAll('secret').length > 1) throw new Error('Bunker URI contains multiple secrets')
  const pubkey = url.hostname.toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pubkey)) throw new Error('Bunker transport key is invalid')
  const relays = [...new Set(url.searchParams.getAll('relay').map(value => new URL(value).toString()))]
  if (relays.length === 0 || relays.length > 3) throw new Error('Bunker URI must contain one to three relays')
  for (const relay of relays) {
    const parsed = new URL(relay)
    if (parsed.protocol !== 'wss:' || parsed.username || parsed.password) throw new Error('Bunker relays must use wss:// without credentials')
  }
  const secret = url.searchParams.get('secret')
  if (secret && secret.length > 512) throw new Error('Bunker secret is too long')
  return { pubkey, relays, secret }
}

async function deadline<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds) }),
  ]).finally(() => clearTimeout(timer!))
}

async function closeRemote(): Promise<void> {
  const current = remote
  remote = null
  generation += 1
  if (!current) return
  try { await current.signer.close() } catch { /* library close is not idempotent */ }
  current.pool.destroy()
}

async function open(stored: StoredBunkerConnection, persist: boolean): Promise<ActiveIdentity> {
  await closeRemote()
  publish({ mode: 'bunker', pubkey: stored.expectedPubkey, status: 'connecting' })
  const pool = new SimplePool({ enablePing: true, enableReconnect: false })
  const sessionGeneration = generation
  let approvalUrl: string | undefined
  const signer = BunkerSigner.fromBunker(stored.clientSecretKey, {
    pubkey: stored.bunkerPubkey,
    relays: stored.relays,
    secret: stored.secret,
  }, {
    pool,
    onauth(raw) {
      if (!remote || remote.generation !== sessionGeneration) return
      try {
        const url = new URL(raw)
        if (url.protocol !== 'https:') return
        approvalUrl = url.toString()
        publish({ mode: 'bunker', pubkey: stored.expectedPubkey, status: 'authorization-required', approvalUrl })
      } catch { /* ignore malformed authorization URLs */ }
    },
  })
  remote = { signer, pool, generation: sessionGeneration }
  try {
    await deadline(signer.connect(), 120_000, 'Remote signer connection')
    const pubkey = await deadline(signer.getPublicKey(), 15_000, 'Remote signer identity')
    if (!/^[0-9a-f]{64}$/.test(pubkey)) throw new Error('Remote signer returned an invalid identity')
    if (stored.expectedPubkey && stored.expectedPubkey !== pubkey) throw new Error('Remote signer identity changed')
    await deadline(signer.ping(), 15_000, 'Remote signer ping')
    if (!remote || remote.generation !== sessionGeneration) throw new Error('Remote signer session changed')
    const connection = { ...stored, expectedPubkey: pubkey }
    if (persist) await saveBunkerConnection(connection)
    publish({ mode: 'bunker', pubkey, status: 'ready', approvalUrl })
    return getActiveIdentity()
  } catch (error) {
    await closeRemote()
    const message = error instanceof Error ? error.message : String(error)
    publish({ mode: 'bunker', pubkey: stored.expectedPubkey, status: 'error', error: message, approvalUrl })
    throw new Error(message)
  }
}

export async function connectBunker(input: string): Promise<ActiveIdentity> {
  const pointer = parsePointer(input.trim())
  const clientSecretKey = generateSecretKey()
  return open({
    clientSecretKey,
    bunkerPubkey: pointer.pubkey,
    relays: pointer.relays,
    secret: pointer.secret,
    expectedPubkey: '',
  }, true)
}

export async function reconnectBunker(): Promise<ActiveIdentity> {
  const stored = await loadBunkerConnection()
  if (!stored) throw new Error('No remote signer connection is stored')
  return open(stored, false)
}

export async function disconnectBunker(): Promise<void> {
  await closeRemote()
  await clearBunkerConnection()
  publish({ mode: 'local', pubkey: getCachedKeypair().publicKey, status: 'ready' })
}

function sameTemplate(template: EventTemplate, event: VerifiedEvent): boolean {
  return event.kind === template.kind && event.created_at === template.created_at
    && event.content === template.content && JSON.stringify(event.tags) === JSON.stringify(template.tags)
}

export async function signWithActiveIdentity(template: EventTemplate): Promise<VerifiedEvent> {
  const active = getActiveIdentity()
  if (active.mode === 'local') return finalizeEvent(template, getCachedKeypair().secretKey)
  if (active.status !== 'ready' || !remote) throw new Error('Remote signer is offline')
  const current = remote
  try {
    const event = await deadline(current.signer.signEvent(template), 30_000, 'Remote signing')
    if (remote !== current || current.generation !== generation) throw new Error('Remote signer session changed')
    if (!verifyEvent(event) || event.pubkey !== active.pubkey || !sameTemplate(template, event)) {
      throw new Error('Remote signer altered the requested event')
    }
    return event
  } catch (error) {
    await closeRemote()
    const message = error instanceof Error ? error.message : String(error)
    publish({ mode: 'bunker', pubkey: active.pubkey, status: 'error', error: message })
    throw new Error(message)
  }
}
