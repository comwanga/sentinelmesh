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
 * Sign a fully spec-compliant NIP-98 auth event with `u` and `method` tags.
 * The gateway validates these tags for exact URL and method match.
 */
export async function signNip98AuthEvent(url: string, method: string): Promise<SignedReportEvent> {
  return signEventAsync({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['u', url], ['method', method]],
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

/**
 * Canonical binding string for a report. The server recomputes this from the
 * submitted fields and rejects the report if it doesn't match the signed event
 * content — so the signature is cryptographically bound to lat/lng/type/desc.
 * Fixed 6-decimal coordinates (~0.1 m) keep JS and Rust formatting identical.
 */
export function reportBindingContent(
  reportType: string,
  lat: number,
  lng: number,
  description: string | null | undefined,
): string {
  return `r1|${reportType}|${lat.toFixed(6)}|${lng.toFixed(6)}|${description ?? ''}`
}

/** Canonical binding string for a vote — binds the signature to this report + choice. */
export function voteBindingContent(vote: string, reportId: string): string {
  return `v1|${vote}|${reportId}`
}

/**
 * Sign a report/vote binding string as a kind-30078 event. The content is the
 * canonical binding (see reportBindingContent / voteBindingContent), so the
 * server can verify the signature covers the exact submitted content.
 */
export function signReport(
  content: string,
  secretKey: Uint8Array,
): SignedReportEvent {
  return finalizeEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', 'sentinel-report']],
    content,
  }, secretKey) as SignedReportEvent
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}
