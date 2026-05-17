import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools'

const SK_STORAGE_KEY = 'sentinel_nostr_sk'

export interface NostrKeypair {
  publicKey: string
  secretKey: Uint8Array
}

export interface SignedReportEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return out
}

export function loadOrCreateKeypair(): NostrKeypair {
  const stored = localStorage.getItem(SK_STORAGE_KEY)
  let sk: Uint8Array
  if (stored && stored.length === 64) {
    sk = fromHex(stored)
  } else {
    sk = generateSecretKey()
    localStorage.setItem(SK_STORAGE_KEY, toHex(sk))
  }
  return { publicKey: getPublicKey(sk), secretKey: sk }
}

export function signAuthEvent(secretKey: Uint8Array): SignedReportEvent {
  return finalizeEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: '',
  }, secretKey) as SignedReportEvent
}

export function signReport(
  payload: Record<string, unknown>,
  secretKey: Uint8Array,
): SignedReportEvent {
  return finalizeEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', 'sentinel-report']],
    content: JSON.stringify(payload),
  }, secretKey) as SignedReportEvent
}
