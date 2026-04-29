import Redis from 'ioredis'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getPool } from '../db/pool'
import { config } from '../config'
import type { SafetyEvent } from '../../../../shared/types'
import type { WsHub } from '../ws/hub'

const schema = JSON.parse(
  readFileSync(join(__dirname, '../../../../shared/contracts/events.schema.json'), 'utf8')
)
const ajv = new Ajv({ allErrors: true })
addFormats(ajv)
const validateEvent = ajv.compile(schema.definitions.SafetyEvent)

// Events that fail PostgreSQL persist go here so they can be replayed manually.
// In production this would write to a file or dead-letter queue.
const DLQ: SafetyEvent[] = []

export async function startEventSubscriber(hub: WsHub): Promise<void> {
  const redis = new Redis(config.redisUrl)

  redis.on('error', (err) => {
    console.error('Redis subscriber error:', err)
  })

  await redis.subscribe('sentinel:events:new')

  redis.on('message', async (_channel: string, raw: string) => {
    let event: SafetyEvent

    try {
      event = JSON.parse(raw)
    } catch {
      console.warn('Received non-JSON on sentinel:events:new, discarding')
      return
    }

    // Reject events that do not match the contract
    if (!validateEvent(event)) {
      console.warn('Event failed schema validation:', validateEvent.errors)
      return
    }

    await persistAndBroadcast(event, hub)
  })

  console.log('Redis event subscriber started on sentinel:events:new')
}

async function persistAndBroadcast(event: SafetyEvent, hub: WsHub): Promise<void> {
  const pool = getPool()

  try {
    await pool.query(
      `INSERT INTO safety_events (
        id, event_type, severity, title, summary,
        lat, lng, place_name, county, radius_meters,
        confidence, source_count, source_breakdown,
        is_active, started_at, last_updated,
        nostr_event_id, bitcoin_txid
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18
      ) ON CONFLICT (id) DO UPDATE SET
        severity = EXCLUDED.severity,
        is_active = EXCLUDED.is_active,
        last_updated = EXCLUDED.last_updated,
        source_count = EXCLUDED.source_count`,
      [
        event.event_id,
        event.event_type,
        event.severity,
        event.title,
        event.summary,
        event.location?.lat ?? null,
        event.location?.lng ?? null,
        event.location?.place_name ?? null,
        event.location?.county ?? null,
        event.location?.radius_meters ?? 500,
        event.confidence,
        event.source_count,
        JSON.stringify(event.source_breakdown),
        event.is_active,
        event.started_at,
        event.last_updated,
        event.nostr_event_id,
        event.bitcoin_txid,
      ]
    )
  } catch (err) {
    console.error('Failed to persist event to PostgreSQL:', err)
    DLQ.push(event)
    return
  }

  hub.broadcast(event.location?.county ?? null, { type: 'NEW_EVENT', payload: event })
}
