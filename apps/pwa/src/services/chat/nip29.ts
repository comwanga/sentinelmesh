// NIP-29 public channel messages and relay state validation. NIP-29 is still a
// draft; client validation protects against malformed or dishonest relay output
// while the relay remains authoritative for write permission.
import type { Event, EventTemplate } from 'nostr-tools'
import type { NostrSigner } from '../signerService'
import { isSignatureValid, singleTag, validMessageContent, withinEventBounds } from './eventValidation'

export const NIP29_KIND_MESSAGE = 9
export const NIP29_KIND_METADATA = 39000
export const NIP29_KIND_ADMINS = 39001
export const NIP29_KIND_MEMBERS = 39002
export const NIP29_KIND_ROLES = 39003
export const NIP29_STATE_KINDS = new Set<number>([NIP29_KIND_METADATA, NIP29_KIND_ADMINS, NIP29_KIND_MEMBERS, NIP29_KIND_ROLES])

// NIP-29 management kinds.
export const NIP29_KIND_ADD_USER = 9000
export const NIP29_KIND_REMOVE_USER = 9001
export const NIP29_KIND_SET_METADATA = 9002
export const NIP29_KIND_DELETE_EVENT = 9005
export const NIP29_KIND_CREATE_GROUP = 9007
export const NIP29_KIND_PIN = 9010

/** Build a NIP-29 management event template bound to exactly one `h` group tag. */
export function buildManagementTemplate(kind: number, groupId: string, tags: string[][], content = ''): EventTemplate {
  return { kind, created_at: Math.floor(Date.now() / 1000), tags: [['h', groupId], ...tags], content }
}

/** Generate a fresh, relay-scoped NIP-29 group id (random hex). */
export function newGroupId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Kind-9007 create-group template for a new public channel. */
export function createGroupTemplate(groupId: string): EventTemplate {
  return buildManagementTemplate(NIP29_KIND_CREATE_GROUP, groupId, [])
}

export function deleteMessageTemplate(groupId: string, eventId: string): EventTemplate {
  return buildManagementTemplate(NIP29_KIND_DELETE_EVENT, groupId, [['e', eventId]])
}

export function removeUserTemplate(groupId: string, pubkey: string): EventTemplate {
  return buildManagementTemplate(NIP29_KIND_REMOVE_USER, groupId, [['p', pubkey.toLowerCase()]])
}

export function setMetadataTemplate(groupId: string, metadata: Record<string, unknown>): EventTemplate {
  return buildManagementTemplate(NIP29_KIND_SET_METADATA, groupId, [], JSON.stringify(metadata))
}

export function pinMessageTemplate(groupId: string, eventId: string): EventTemplate {
  return buildManagementTemplate(NIP29_KIND_PIN, groupId, [['e', eventId]])
}

export interface ChannelMessage {
  groupId: string
  template: EventTemplate
}

/** Build a kind-9 channel message bound to exactly one `h` group tag. */
export function createChannelMessage(
  signerPubkey: string,
  groupId: string,
  content: string,
): ChannelMessage {
  if (!validMessageContent(content)) throw new Error('invalid message content')
  if (!groupId) throw new Error('missing group id')
  return {
    groupId,
    template: {
      kind: NIP29_KIND_MESSAGE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['h', groupId]],
      content,
    },
  }
}

/** Validate an inbound kind-9 channel message for the requested group. */
export function validateChannelMessage(event: Event, groupId: string, now?: number): boolean {
  if (event.kind !== NIP29_KIND_MESSAGE) return false
  if (!withinEventBounds(event, now)) return false
  if (!isSignatureValid(event)) return false
  if (singleTag(event, 'h') !== groupId) return false
  return validMessageContent(event.content)
}

/** Validate relay-generated group state events (39000–39003). */
export function validateGroupStateEvent(event: Event, groupId: string, relaySelfPubkey: string | null): boolean {
  if (!NIP29_STATE_KINDS.has(event.kind)) return false
  if (!withinEventBounds(event)) return false
  if (!isSignatureValid(event)) return false
  if (singleTag(event, 'd') !== groupId && singleTag(event, 'h') !== groupId) return false
  if (relaySelfPubkey && event.pubkey !== relaySelfPubkey) return false
  return true
}

// Re-exported so callers can sign a channel message through the active signer.
export async function signChannelMessage(signer: NostrSigner, message: ChannelMessage): Promise<Event> {
  return signer.signEvent(message.template)
}
