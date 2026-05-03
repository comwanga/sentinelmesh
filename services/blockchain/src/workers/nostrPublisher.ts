import { finalizeEvent, Relay } from 'nostr-tools'

export interface PublishPayload {
  source_id: string
  source_type: 'SAFETY_EVENT' | 'COMMUNITY_REPORT'
  severity: string
  event_type: string
  lat: number
  lng: number
  place_name?: string | null
}

export interface PublishResult {
  kind1_id: string
  kind30078_id: string
}

const RELAY_TIMEOUT_MS = 5000

async function publishWithTimeout(
  relay: { publish: (e: ReturnType<typeof finalizeEvent>) => Promise<unknown>; close: () => void },
  event: ReturnType<typeof finalizeEvent>,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), RELAY_TIMEOUT_MS)
    relay
      .publish(event)
      .then(() => { clearTimeout(timer); resolve(true) })
      .catch(() => { clearTimeout(timer); resolve(false) })
  })
}

export async function publishNostrEvents(
  privkeyHex: string,
  relayUrls: string[],
  payload: PublishPayload,
  nowSec?: number,
): Promise<PublishResult> {
  // Buffer is a Uint8Array subclass — compatible with finalizeEvent's privkey param.
  const privkey = Buffer.from(privkeyHex, 'hex') as unknown as Uint8Array
  const location = payload.place_name ?? `${payload.lat},${payload.lng}`
  const now = nowSec ?? Math.floor(Date.now() / 1000)

  const kind1 = finalizeEvent(
    {
      kind: 1,
      created_at: now,
      tags: [
        ['t', 'sentinelmesh'],
        ['t', 'safetymesh'],
        ['t', payload.severity.toLowerCase()],
      ],
      content: `🚨 ${payload.severity} ${payload.event_type} reported at ${location}. #SentinelMesh`,
    },
    privkey,
  )

  const kind30078 = finalizeEvent(
    {
      kind: 30078,
      created_at: now,
      tags: [
        ['d', `sentinelmesh:${payload.source_id}`],
        ['source_type', payload.source_type],
        ['source_id', payload.source_id],
        ['severity', payload.severity],
        ['event_type', payload.event_type],
        ['lat', String(payload.lat)],
        ['lng', String(payload.lng)],
      ],
      content: JSON.stringify({ event_id: payload.source_id, severity: payload.severity }),
    },
    privkey,
  )

  const relays = await Promise.all(
    relayUrls.map((url) => Relay.connect(url).catch(() => null)),
  )
  const active = relays.filter(
    (r): r is Relay => r !== null,
  )

  if (active.length === 0) {
    throw new Error('Could not connect to any Nostr relay')
  }

  for (const event of [kind1, kind30078]) {
    const results = await Promise.all(active.map((r) => publishWithTimeout(r, event)))
    if (!results.some(Boolean)) {
      for (const r of active) r.close()
      throw new Error(`All relays rejected event kind ${event.kind}`)
    }
  }

  for (const r of active) r.close()

  return { kind1_id: kind1.id, kind30078_id: kind30078.id }
}
