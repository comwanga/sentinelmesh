import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import { saveSecretKey, loadOrCreateSecretKey } from './identityStore'

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

// Session cache of the local identity. Decrypted once at boot (loadIdentity) and
// held in memory for the session — an in-session XSS could read it on the next
// sign either way, so per-sign decrypt-and-zero is deferred to later hardening.
let _keypair: NostrKeypair | null = null
// In-flight init, shared by concurrent callers (e.g. React StrictMode double
// invoke, or several views booting at once) so the identity is created ONCE.
let _initPromise: Promise<NostrKeypair> | null = null

/**
 * Load (or create + persist) the local Nostr identity. Idempotent and
 * concurrency-safe: never regenerates when a key already exists, and concurrent
 * callers share one init (and `loadOrCreateSecretKey` serializes across tabs via
 * the Web Locks API). Awaited once at app boot so the cache is ready before
 * anything signs. Falls back to an in-memory key if storage is unavailable
 * (e.g. private browsing) so the app still runs (degraded).
 */
export async function loadIdentity(): Promise<NostrKeypair> {
  if (_keypair) return _keypair
  if (!_initPromise) {
    _initPromise = (async () => {
      try {
        const sk = await loadOrCreateSecretKey(generateSecretKey)
        _keypair = { publicKey: getPublicKey(sk), secretKey: sk }
      } catch {
        // Degrade: storage unavailable (e.g. private browsing / quota). The key
        // is NOT persisted, so every reload mints a fresh one — the identity is
        // not stable in this mode, but the app stays usable.
        const sk = generateSecretKey()
        _keypair = { publicKey: getPublicKey(sk), secretKey: sk }
      }
      return _keypair!
    })()
  }
  return _initPromise
}

/**
 * Synchronous accessor for the loaded identity, for the existing sync call sites.
 * `loadIdentity()` is awaited at boot, so the cache is populated. Last-resort:
 * mints a transient in-memory key if somehow called before init, so a render
 * never crashes.
 */
export function getCachedKeypair(): NostrKeypair {
  if (!_keypair) {
    const sk = generateSecretKey()
    _keypair = { publicKey: getPublicKey(sk), secretKey: sk }
  }
  return _keypair
}

/** Explicit, user-confirmed identity reset: generate + persist a NEW key. */
export async function generateNewIdentity(): Promise<NostrKeypair> {
  const sk = generateSecretKey()
  await saveSecretKey(sk)
  _keypair = { publicKey: getPublicKey(sk), secretKey: sk }
  // Drop any in-flight boot init so a concurrent loadIdentity() cannot resolve
  // and overwrite the cache with the pre-reset key.
  _initPromise = null
  return _keypair
}

/** Restore an identity from a raw secret key (backup restore): persist + cache. */
export async function restoreIdentityFromSecretKey(sk: Uint8Array): Promise<NostrKeypair> {
  await saveSecretKey(sk)
  _keypair = { publicKey: getPublicKey(sk), secretKey: sk }
  _initPromise = null
  return _keypair
}

/** Test-only: drop the in-memory cache + in-flight init to simulate a page reload. */
export function __resetIdentityCacheForTests(): void {
  _keypair = null
  _initPromise = null
}

export function hasNip07(): boolean {
  return typeof window !== 'undefined' && 'nostr' in window
}

/**
 * Import a keypair from nsec and PERSIST it (survives reload). Returns null on an
 * invalid nsec.
 */
export async function importFromNsec(nsecStr: string): Promise<NostrKeypair | null> {
  try {
    const decoded = nip19.decode(nsecStr.trim())
    if (decoded.type !== 'nsec') return null
    const sk = decoded.data as Uint8Array
    await saveSecretKey(sk)
    _keypair = { publicKey: getPublicKey(sk), secretKey: sk }
    // Drop any in-flight boot init so it cannot overwrite the imported key.
    _initPromise = null
    return _keypair
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
 * Uses NIP-07 extension if available, falls back to session-cached key.
 */
export async function signEventAsync(template: {
  kind: number
  created_at: number
  tags: string[][]
  content: string
}): Promise<SignedReportEvent> {
  const { signWithActiveIdentity } = await import('./signerService')
  return signWithActiveIdentity(template)
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
export async function signNip98AuthEvent(
  url: string,
  method: string,
  payloadHash?: string,
): Promise<SignedReportEvent> {
  const tags: string[][] = [['u', url], ['method', method], ['nonce', crypto.randomUUID()]]
  // NIP-98 body binding: include sha256(body) so the signature covers the payload.
  if (payloadHash) tags.push(['payload', payloadHash])
  return signEventAsync({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  })
}

/** Sign NIP-98 with the device identity even when a NIP-07 extension is present. */
export function signLocalNip98AuthEvent(
  url: string,
  method: string,
  payloadHash?: string,
): SignedReportEvent {
  const tags: string[][] = [['u', url], ['method', method], ['nonce', crypto.randomUUID()]]
  if (payloadHash) tags.push(['payload', payloadHash])
  return finalizeEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  }, getCachedKeypair().secretKey) as SignedReportEvent
}

export async function signBoundEvent(content: string): Promise<SignedReportEvent> {
  return signEventAsync({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [], content })
}

/** Lowercase hex sha256 of a UTF-8 string (for NIP-98 payload binding). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Get the current user's public key (from NIP-07 or session-cached fallback).
 */
export async function getPublicKeyAsync(): Promise<string> {
  if (hasNip07()) {
    const ext = (window as unknown as { nostr: { getPublicKey: () => Promise<string> } }).nostr
    return ext.getPublicKey()
  }
  return getCachedKeypair().publicKey
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

/** Canonical binding for a vouch — must byte-match the gateway `vouch_binding_content`. */
export function vouchBindingContent(voucheePubkey: string): string {
  return `sentinelmesh:vouch:v1:${voucheePubkey}`
}

/** Canonical binding for a vouch revocation — must byte-match `vouch_revoke_binding_content`. */
export function vouchRevokeBindingContent(voucheePubkey: string): string {
  return `sentinelmesh:vouch-revoke:v1:${voucheePubkey}`
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
