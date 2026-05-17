import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools'
import { nip19 } from 'nostr-tools'

const SK_STORAGE_KEY = 'sentinel_nostr_sk'

export interface NostrKeypair {
  publicKey: string   // hex
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

export function toNpub(hexPubkey: string): string {
  try { return nip19.npubEncode(hexPubkey) } catch { return hexPubkey }
}

export function toNsec(secretKey: Uint8Array): string {
  try { return nip19.nsecEncode(secretKey) } catch { return toHex(secretKey) }
}

export function importFromNsec(nsecStr: string): NostrKeypair | null {
  try {
    const decoded = nip19.decode(nsecStr.trim())
    if (decoded.type !== 'nsec') return null
    const sk = decoded.data as Uint8Array
    localStorage.setItem(SK_STORAGE_KEY, toHex(sk))
    return { publicKey: getPublicKey(sk), secretKey: sk }
  } catch {
    return null
  }
}

export function hexFromNpubOrHex(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(trimmed)
      if (decoded.type === 'npub') return decoded.data as string
    } catch { return null }
  }
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase()
  return null
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
