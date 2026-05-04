import { Pool } from 'pg'
import { randomUUID } from 'crypto'
import { config } from '../config'
import { getPool } from '../db/pool'
import { publishNostrEvents } from './nostrPublisher'
import { broadcastAnchor } from './bitcoinAnchor'
import { buildAnchorHash } from '../utils/canonicalHash'

export interface PublishJob {
  id: string
  source_type: 'SAFETY_EVENT' | 'COMMUNITY_REPORT'
  source_id: string
  status: string
  nostr_kind1_id: string | null
  nostr_kind30078_id: string | null
  bitcoin_txid: string | null
  anchor_hash: string | null
  retry_count: number
}

const MAX_RETRIES = 5
const ORPHAN_TIMEOUT_MINUTES = 5

export async function claimNextJob(pool: Pool, workerId: string): Promise<PublishJob | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<PublishJob>(`
      UPDATE publish_jobs
      SET status = 'PROCESSING',
          worker_id = $1,
          locked_at = NOW(),
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM publish_jobs
        WHERE (
          status IN ('PENDING', 'FAILED') AND next_retry_at <= NOW()
          OR status IN ('NOSTR_PUBLISHED', 'BITCOIN_ANCHORED')
        )
        ORDER BY next_retry_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *
    `, [workerId])
    await client.query('COMMIT')
    return result.rows[0] ?? null
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function markFailed(pool: Pool, jobId: string, errorMessage: string, currentRetryCount: number): Promise<void> {
  const backoffMinutes = Math.pow(2, currentRetryCount)
  await pool.query(`
    UPDATE publish_jobs
    SET status = 'FAILED',
        retry_count = retry_count + 1,
        next_retry_at = NOW() + ($3 * INTERVAL '1 minute'),
        error_message = $2,
        worker_id = NULL,
        locked_at = NULL,
        updated_at = NOW()
    WHERE id = $1
  `, [jobId, errorMessage, backoffMinutes])
  await pool.query(
    `INSERT INTO publish_failures (job_id, step, error_message) VALUES ($1, 'PUBLISH', $2)`,
    [jobId, errorMessage],
  )
}

export async function markDead(pool: Pool, jobId: string): Promise<void> {
  await pool.query(
    `UPDATE publish_jobs SET status = 'DEAD', updated_at = NOW() WHERE id = $1`,
    [jobId],
  )
}

async function fetchSourceRow(pool: Pool, job: PublishJob): Promise<{
  severity: string
  event_type: string
  lat: number
  lng: number
  place_name: string | null
} | null> {
  const table = job.source_type === 'SAFETY_EVENT' ? 'safety_events' : 'community_reports'
  const typeCol = job.source_type === 'SAFETY_EVENT' ? 'event_type' : 'report_type'
  const result = await pool.query(
    `SELECT severity, ${typeCol} AS event_type, lat, lng, place_name FROM ${table} WHERE id = $1`,
    [job.source_id],
  )
  return result.rows[0] ?? null
}

async function updateSourceRow(pool: Pool, job: PublishJob): Promise<void> {
  if (job.source_type === 'SAFETY_EVENT') {
    await pool.query(
      `UPDATE safety_events
       SET nostr_event_id = $2, bitcoin_txid = $3
       WHERE id = $1 AND nostr_event_id IS NULL`,
      [job.source_id, job.nostr_kind30078_id, job.bitcoin_txid],
    )
  } else {
    await pool.query(
      `UPDATE community_reports
       SET nostr_event_id = $2
       WHERE id = $1 AND nostr_event_id IS NULL`,
      [job.source_id, job.nostr_kind30078_id],
    )
  }
}

async function reclaimOrphans(pool: Pool): Promise<void> {
  await pool.query(`
    UPDATE publish_jobs
    SET status = 'FAILED',
        worker_id = NULL,
        locked_at = NULL,
        retry_count = retry_count + 1,
        next_retry_at = NOW(),
        error_message = 'orphan reclaim after ${ORPHAN_TIMEOUT_MINUTES} minute timeout',
        updated_at = NOW()
    WHERE status IN ('PROCESSING', 'NOSTR_PUBLISHED', 'BITCOIN_ANCHORED')
      AND locked_at < NOW() - INTERVAL '${ORPHAN_TIMEOUT_MINUTES} minutes'
  `)
}

async function processJob(pool: Pool, job: PublishJob): Promise<void> {
  const source = await fetchSourceRow(pool, job)
  if (!source) {
    await markDead(pool, job.id)
    return
  }

  let kind1_id = job.nostr_kind1_id
  let kind30078_id = job.nostr_kind30078_id

  if (!kind1_id || !kind30078_id) {
    const nostrResult = await publishNostrEvents(config.nostrPrivkey, config.relayUrls, {
      source_id: job.source_id,
      source_type: job.source_type,
      severity: source.severity,
      event_type: source.event_type,
      lat: Number(source.lat),
      lng: Number(source.lng),
      place_name: source.place_name,
    })
    kind1_id = nostrResult.kind1_id
    kind30078_id = nostrResult.kind30078_id
    await pool.query(
      `UPDATE publish_jobs
       SET status = 'NOSTR_PUBLISHED', nostr_kind1_id = $2, nostr_kind30078_id = $3, updated_at = NOW()
       WHERE id = $1`,
      [job.id, kind1_id, kind30078_id],
    )
  }

  if (!job.bitcoin_txid) {
    const hash = buildAnchorHash({
      event_id: job.source_id,
      nostr_event_id: kind30078_id!,
      severity: source.severity,
    })
    // NOTE: UTXO (txid/vout/value/changeAddress) must be manually rotated after each anchor.
    // The change output of the previous TX is not automatically fed back as input.
    // Monitor BITCOIN_UTXO_TXID and BITCOIN_UTXO_VALUE env vars before deploying to mainnet.
    const txid = await broadcastAnchor({
      anchorHash: hash,
      wif: config.bitcoinWif,
      utxoTxid: process.env.BITCOIN_UTXO_TXID ?? '',
      utxoVout: parseInt(process.env.BITCOIN_UTXO_VOUT ?? '0', 10),
      utxoValue: parseInt(process.env.BITCOIN_UTXO_VALUE ?? '10000', 10),
      changeAddress: process.env.BITCOIN_CHANGE_ADDRESS ?? '',
      network: config.bitcoinNetwork,
    })
    await pool.query(
      `UPDATE publish_jobs
       SET status = 'BITCOIN_ANCHORED', bitcoin_txid = $2, anchor_hash = $3, updated_at = NOW()
       WHERE id = $1`,
      [job.id, txid, hash],
    )
    job.bitcoin_txid = txid
    job.nostr_kind1_id = kind1_id
    job.nostr_kind30078_id = kind30078_id
  }

  await updateSourceRow(pool, job)
  await pool.query(
    `UPDATE publish_jobs SET status = 'COMPLETE', updated_at = NOW() WHERE id = $1`,
    [job.id],
  )
}

export function startPublishWorker(): { triggerNudge: () => void } {
  const pool = getPool()
  const workerId = `worker-${randomUUID()}`
  let orphanTick = 0

  async function tick(): Promise<void> {
    orphanTick++
    if (orphanTick % 30 === 0) {
      await reclaimOrphans(pool).catch(err => console.error('[worker] orphan reclaim error:', err))
    }

    let job: PublishJob | null = null
    try {
      job = await claimNextJob(pool, workerId)
      if (!job) return

      if (job.retry_count >= MAX_RETRIES) {
        await markDead(pool, job.id)
        return
      }

      await processJob(pool, job)
    } catch (err) {
      console.error('[worker] tick error:', err)
      if (job) {
        await markFailed(pool, job.id, (err as Error).message ?? String(err), job.retry_count)
          .catch(e => console.error('[worker] markFailed error:', e))
      }
    }
  }

  setInterval(() => tick().catch(console.error), config.pollIntervalMs)
  tick().catch(console.error)

  return { triggerNudge: () => tick().catch(console.error) }
}
