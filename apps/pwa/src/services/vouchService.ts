// Issue / revoke a web-of-trust vouch (C-1a). The vouch is an explicit, signed,
// PUBLIC attestation — it does not touch the E2EE circle graph.
import { vouchBindingContent, vouchRevokeBindingContent, signBoundEvent } from './nostrService'

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? ''

/** Sign and submit a vouch for `voucheePubkey` (hex). Resolves true on success. */
export async function issueVouch(voucheePubkey: string): Promise<boolean> {
  const binding = vouchBindingContent(voucheePubkey)
  // signReport already signs an event whose content IS `binding`; the explicit
  // `content: binding` is a no-op in production (same string the id/sig cover) and
  // only makes the mock-based test deterministic. Never set content to anything else.
  const event = await signBoundEvent(binding)
  const res = await fetch(`${API_BASE}/api/vouches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voucher_pubkey: event.pubkey, vouchee_pubkey: voucheePubkey, nostr_event: event }),
  })
  return res.ok
}

/** Sign and submit a revocation of a vouch for `voucheePubkey`. */
export async function revokeVouch(voucheePubkey: string): Promise<boolean> {
  const binding = vouchRevokeBindingContent(voucheePubkey)
  const event = await signBoundEvent(binding)
  const res = await fetch(`${API_BASE}/api/vouches/${voucheePubkey}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voucher_pubkey: event.pubkey, nostr_event: event }),
  })
  return res.ok
}
