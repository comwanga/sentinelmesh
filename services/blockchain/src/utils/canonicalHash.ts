import { createHash } from 'crypto'

interface AnchorParams {
  event_id: string
  nostr_event_id: string
  severity: string
}

export function buildAnchorHash(params: AnchorParams): string {
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(params).sort()) {
    sorted[key] = params[key as keyof AnchorParams]
  }
  const canonical = JSON.stringify(sorted)
  return createHash('sha256').update(canonical).digest('hex')
}
