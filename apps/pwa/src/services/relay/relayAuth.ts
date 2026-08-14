// NIP-42 relay authentication. Clients respond to a relay `AUTH` challenge by
// signing a kind-22242 event bound to the relay URL and the challenge string.
import type { EventTemplate, VerifiedEvent } from 'nostr-tools'
import type { NostrSigner } from '../signerService'

export const NIP42_AUTH_KIND = 22242

/** Build an unsigned kind-22242 auth template bound to a relay URL + challenge. */
export function nip42AuthTemplate(relayUrl: string, challenge: string): EventTemplate {
  return {
    kind: NIP42_AUTH_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['relay', relayUrl],
      ['challenge', challenge],
    ],
    content: '',
  }
}

/** Sign a NIP-42 AUTH event with the active signer. */
export async function signNip42Auth(
  signer: NostrSigner,
  relayUrl: string,
  challenge: string,
): Promise<VerifiedEvent> {
  return signer.signEvent(nip42AuthTemplate(relayUrl, challenge))
}

/**
 * nostr-tools `AbstractSimplePool` auto-auth callback. It receives the relay URL
 * and returns a function that signs the relay's challenge event template.
 */
export function automaticAuth(
  signer: NostrSigner,
): (relayUrl: string) => (event: EventTemplate) => Promise<VerifiedEvent> {
  return () => (event) => signer.signEvent(event)
}
