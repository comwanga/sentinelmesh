// Issue / revoke a web-of-trust vouch (C-1a). The vouch is an explicit, signed,
// PUBLIC attestation — it does not touch the E2EE circle graph.
import { getCachedKeypair, vouchBindingContent, vouchRevokeBindingContent, signReport } from './nostrService'

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? ''

/** Sign and submit a vouch for `voucheePubkey` (hex). Resolves true on success. */
export async function issueVouch(voucheePubkey: string): Promise<boolean> {
  const kp = getCachedKeypair()
  const binding = vouchBindingContent(voucheePubkey)
  // Override content to make the binding explicit and the mock-based test deterministic.
  // In production signReport already sets content=binding, so this is a no-op there and
  // the id/sig remain valid (they were computed over the same binding string).
  const event = { ...signReport(binding, kp.secretKey), content: binding }
  const res = await fetch(`${API_BASE}/api/vouches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voucher_pubkey: kp.publicKey, vouchee_pubkey: voucheePubkey, nostr_event: event }),
  })
  return res.ok
}

/** Sign and submit a revocation of a vouch for `voucheePubkey`. */
export async function revokeVouch(voucheePubkey: string): Promise<boolean> {
  const kp = getCachedKeypair()
  const binding = vouchRevokeBindingContent(voucheePubkey)
  const event = { ...signReport(binding, kp.secretKey), content: binding }
  const res = await fetch(`${API_BASE}/api/vouches/${voucheePubkey}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voucher_pubkey: kp.publicKey, nostr_event: event }),
  })
  return res.ok
}
