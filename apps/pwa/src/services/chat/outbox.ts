// Durable NIP-17 outbox: persist gift wraps per recipient, publish to that
// recipient's relays, and mark delivered on at least one acknowledgement.
// Transient failures retry with capped exponential backoff.
import type { Event } from 'nostr-tools'
import type { RelayClient } from '../relay/relayClient'
import { listPendingOutbox, putOutboxItem } from './chatStore'

const MAX_BACKOFF_MS = 30 * 60_000

export async function enqueueOutbox(
  recipientPubkey: string,
  relays: string[],
  wrap: Event,
): Promise<void> {
  await putOutboxItem({
    id: wrap.id,
    recipient_pubkey: recipientPubkey,
    relays,
    wrap: JSON.stringify(wrap),
    attempts: 0,
    next_retry_at: 0,
    delivered: false,
  })
}

export async function deliverPendingOutbox(
  client: RelayClient,
  now = Date.now(),
): Promise<{ delivered: number; failed: number }> {
  const pending = await listPendingOutbox(now)
  let delivered = 0
  let failed = 0
  for (const item of pending) {
    const wrap = JSON.parse(item.wrap) as Event
    const results = await client.publish(item.relays, wrap)
    const ok = results.some(result => result.ok)
    if (ok) {
      await putOutboxItem({ ...item, delivered: true })
      delivered++
    } else {
      const attempts = item.attempts + 1
      const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts)
      await putOutboxItem({ ...item, attempts, next_retry_at: now + backoff })
      failed++
    }
  }
  return { delivered, failed }
}
