// Local DM moderation policy: block/mute lists and unknown-sender quarantine.
// Relay-side NIP-29 moderation remains authoritative for public channels.
import { getPreference, setPreference } from './chatStore'

const BLOCKED_KEY = 'moderation:blocked_pubkeys'
const MUTED_KEY = 'moderation:muted_pubkeys'

export type QuarantineDecision = 'accept' | 'quarantine' | 'block'

export async function blockedPubkeys(): Promise<string[]> {
  return (await getPreference<string[]>(BLOCKED_KEY)) ?? []
}

export async function mutedPubkeys(): Promise<string[]> {
  return (await getPreference<string[]>(MUTED_KEY)) ?? []
}

export async function isBlocked(pubkey: string): Promise<boolean> {
  return (await blockedPubkeys()).includes(pubkey.toLowerCase())
}

export async function isMuted(pubkey: string): Promise<boolean> {
  return (await mutedPubkeys()).includes(pubkey.toLowerCase())
}

export async function blockPubkey(pubkey: string): Promise<void> {
  const list = new Set(await blockedPubkeys())
  list.add(pubkey.toLowerCase())
  await setPreference(BLOCKED_KEY, [...list])
}

export async function unblockPubkey(pubkey: string): Promise<void> {
  await setPreference(BLOCKED_KEY, (await blockedPubkeys()).filter(p => p !== pubkey.toLowerCase()))
}

export async function mutePubkey(pubkey: string): Promise<void> {
  const list = new Set(await mutedPubkeys())
  list.add(pubkey.toLowerCase())
  await setPreference(MUTED_KEY, [...list])
}

export async function unmutePubkey(pubkey: string): Promise<void> {
  await setPreference(MUTED_KEY, (await mutedPubkeys()).filter(p => p !== pubkey.toLowerCase()))
}

/**
 * Decide whether an inbound DM should be accepted, quarantined, or blocked.
 * Contacts and current Circle members bypass quarantine; blocked senders are
 * always suppressed.
 */
export function quarantineDecision(
  pubkey: string,
  opts: { isContact: boolean; isCircleMember: boolean; isBlocked: boolean },
): QuarantineDecision {
  if (opts.isBlocked) return 'block'
  if (opts.isContact || opts.isCircleMember) return 'accept'
  return 'quarantine'
}
