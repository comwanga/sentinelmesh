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

// In-memory ephemeral key — never persisted. Lost on page refresh.
// Users with NIP-07 extensions bypass this entirely.
let _ephemeralKeypair: NostrKeypair | null = null

export function hasNip07(): boolean {
  return typeof window !== 'undefined' && 'nostr' in window
}

export function getOrCreateEphemeralKeypair(): NostrKeypair {
  if (!_ephemeralKeypair) {
    const sk = generateSecretKey()
    _ephemeralKeypair = { publicKey: getPublicKey(sk), secretKey: sk }
  }
  return _ephemeralKeypair
}

/** Returns ephemeral keypair. No longer persists to localStorage. */
export function loadOrCreateKeypair(): NostrKeypair {
  return getOrCreateEphemeralKeypair()
}

/**
 * Import a keypair from nsec. Stored in-memory only (lost on page refresh).
 * Users with NIP-07 extensions should use the extension instead.
 */
export function importFromNsec(nsecStr: string): NostrKeypair | null {
  try {
    const decoded = nip19.decode(nsecStr.trim())
    if (decoded.type !== 'nsec') return null
    const sk = decoded.data as Uint8Array
    _ephemeralKeypair = { publicKey: getPublicKey(sk), secretKey: sk }
    return _ephemeralKeypair
  } catch {
    return null
  }
}

/** Remove any legacy raw key stored in localStorage from previous versions. */
export function clearStoredKey(): void {
  localStorage.removeItem(SK_STORAGE_KEY)
}

export function toNpub(hexPubkey: string): string {
  try { return nip19.npubEncode(hexPubkey) } catch { return hexPubkey }
}

export function toNsec(secretKey: Uint8Array): string {
  try { return nip19.nsecEncode(secretKey) } catch { return toHex(secretKey) }
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

/**
 * Sign an arbitrary Nostr event template.
 * Uses NIP-07 extension if available, falls back to in-memory ephemeral key.
 */
export async function signEventAsync(template: {
  kind: number
  created_at: number
  tags: string[][]
  content: string
}): Promise<SignedReportEvent> {
  if (hasNip07()) {
    const ext = (window as unknown as { nostr: { signEvent: (e: unknown) => Promise<SignedReportEvent> } }).nostr
    return ext.signEvent(template)
  }
  const keypair = getOrCreateEphemeralKeypair()
  return finalizeEvent(template, keypair.secretKey) as SignedReportEvent
}

/**
 * Sign a NIP-98 Kind 27235 auth event (used for X-Nostr-Auth header).
 * Async because NIP-07 extension signing is async.
 */
export async function signAuthEvent(): Promise<SignedReportEvent> {
  return signEventAsync({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: '',
  })
}

/**
 * Get the current user's public key (from NIP-07 or in-memory fallback).
 */
export async function getPublicKeyAsync(): Promise<string> {
  if (hasNip07()) {
    const ext = (window as unknown as { nostr: { getPublicKey: () => Promise<string> } }).nostr
    return ext.getPublicKey()
  }
  return getOrCreateEphemeralKeypair().publicKey
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

// ── Internal helpers ─────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}
