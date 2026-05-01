import { verifyEvent } from 'nostr-tools'

export interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

export function verifyNostrSignature(event: NostrEvent): boolean {
  try {
    // Create a fresh copy to avoid cached verification results from verifyEvent's internal symbol
    const freshEvent = JSON.parse(JSON.stringify(event))
    return verifyEvent(freshEvent as Parameters<typeof verifyEvent>[0])
  } catch {
    return false
  }
}
