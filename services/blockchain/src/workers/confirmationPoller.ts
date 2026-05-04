import { Pool } from 'pg'

const STUCK_TX_MS = 24 * 60 * 60 * 1000  // 24 hours

const MEMPOOL_TX_URL: Record<'mainnet' | 'testnet', string> = {
  mainnet: 'https://mempool.space/api/tx',
  testnet: 'https://mempool.space/testnet/api/tx',
}

const NOT_FOUND = Symbol('NOT_FOUND')
const TRANSIENT_ERROR = Symbol('TRANSIENT_ERROR')

interface TxConfirmStatus {
  confirmed: boolean
  block_height?: number
}

async function fetchTxStatus(
  txid: string,
  network: 'mainnet' | 'testnet',
): Promise<TxConfirmStatus | typeof NOT_FOUND | typeof TRANSIENT_ERROR> {
  try {
    const res = await fetch(`${MEMPOOL_TX_URL[network]}/${txid}`, {
      signal: AbortSignal.timeout(10000),
    })
    if (res.status === 404) return NOT_FOUND
    if (!res.ok) return TRANSIENT_ERROR
    const data = await res.json() as { status: TxConfirmStatus }
    return data.status
  } catch {
    return TRANSIENT_ERROR
  }
}

export async function pollOnce(pool: Pool, network: 'mainnet' | 'testnet'): Promise<void> {
  const utxoResult = await pool.query<{ id: string; txid: string; created_at: string }>(
    `SELECT id, txid, created_at FROM utxos WHERE status = 'UNCONFIRMED'`,
  )
  const jobResult = await pool.query<{ id: string; txid: string; source_type: string; source_id: string }>(
    `SELECT id, bitcoin_txid AS txid, source_type, source_id
     FROM publish_jobs WHERE status = 'BITCOIN_ANCHORED' AND bitcoin_txid IS NOT NULL`,
  )

  const utxosByTxid = new Map<string, typeof utxoResult.rows>()
  for (const row of utxoResult.rows) {
    const existing = utxosByTxid.get(row.txid) ?? []
    utxosByTxid.set(row.txid, [...existing, row])
  }

  const jobsByTxid = new Map<string, typeof jobResult.rows>()
  for (const row of jobResult.rows) {
    const existing = jobsByTxid.get(row.txid) ?? []
    jobsByTxid.set(row.txid, [...existing, row])
  }

  const allTxids = new Set([...utxosByTxid.keys(), ...jobsByTxid.keys()])

  for (const txid of allTxids) {
    const status = await fetchTxStatus(txid, network)

    if (status === TRANSIENT_ERROR) {
      console.warn('[poller] transient error fetching txid, will retry next tick:', txid)
      continue
    }

    if (status === NOT_FOUND) {
      console.error('[poller] txid not found on network (404):', txid)
      for (const job of jobsByTxid.get(txid) ?? []) {
        await pool.query(
          `UPDATE publish_jobs
           SET status = 'FAILED', error_message = $2, retry_count = retry_count + 1,
               next_retry_at = NOW(), worker_id = NULL, locked_at = NULL, updated_at = NOW()
           WHERE id = $1`,
          [job.id, `txid not found on network: ${txid}`],
        )
        await pool.query(
          `INSERT INTO publish_failures (job_id, step, error_message) VALUES ($1, 'BITCOIN_BROADCAST', $2)`,
          [job.id, `txid not found: ${txid}`],
        )
      }
      continue
    }

    // Check for stuck transactions (>24h UNCONFIRMED, not yet confirmed)
    if (!status.confirmed) {
      for (const utxo of utxosByTxid.get(txid) ?? []) {
        const ageMs = Date.now() - new Date(utxo.created_at).getTime()
        if (ageMs > STUCK_TX_MS) {
          console.warn('[poller] stuck transaction >24h unconfirmed:', txid)
        }
      }
      continue
    }

    const blockHeight = status.block_height!

    for (const utxo of utxosByTxid.get(txid) ?? []) {
      await pool.query(
        `UPDATE utxos SET status = 'CONFIRMED', updated_at = NOW() WHERE id = $1 AND status = 'UNCONFIRMED'`,
        [utxo.id],
      )
    }

    for (const job of jobsByTxid.get(txid) ?? []) {
      await pool.query(
        `UPDATE publish_jobs SET status = 'COMPLETE', updated_at = NOW()
         WHERE id = $1 AND status = 'BITCOIN_ANCHORED'`,
        [job.id],
      )
      const sourceTable = job.source_type === 'SAFETY_EVENT' ? 'safety_events' : 'community_reports'
      await pool.query(
        `UPDATE ${sourceTable} SET bitcoin_block = $2 WHERE id = $1`,
        [job.source_id, blockHeight],
      )
    }
  }
}

export function startConfirmationPoller(
  pool: Pool,
  network: 'mainnet' | 'testnet',
): { stop: () => void } {
  const timer = setInterval(
    () => pollOnce(pool, network).catch(err => console.error('[poller] tick error:', err)),
    60_000,
  )
  pollOnce(pool, network).catch(err => console.error('[poller] initial tick error:', err))
  return { stop: () => clearInterval(timer) }
}
