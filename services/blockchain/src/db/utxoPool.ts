import { Pool } from 'pg'

export interface Utxo {
  id: string
  txid: string
  vout: number
  value_sats: number
  status: 'CONFIRMED' | 'LOCKED' | 'UNCONFIRMED' | 'SPENT'
  spending_job_id: string | null
  creating_job_id: string | null
  locked_at: string | null
}

export interface PoolDepth {
  available: number
  locked: number
  unconfirmed: number
}

function parseUtxo(row: Record<string, unknown>): Utxo {
  return { ...(row as unknown as Utxo), value_sats: Number(row.value_sats) }
}

export async function claimUtxo(pool: Pool, jobId: string): Promise<Utxo | null> {
  const result = await pool.query<Record<string, unknown>>(`
    UPDATE utxos
    SET status = 'LOCKED',
        spending_job_id = $1,
        locked_at = NOW(),
        updated_at = NOW()
    WHERE id = (
      SELECT id FROM utxos
      WHERE status = 'CONFIRMED'
      ORDER BY value_sats DESC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `, [jobId])
  return result.rows[0] ? parseUtxo(result.rows[0]) : null
}

export async function releaseUtxo(pool: Pool, utxoId: string): Promise<void> {
  await pool.query(
    `UPDATE utxos
     SET status = 'CONFIRMED', spending_job_id = NULL, locked_at = NULL, updated_at = NOW()
     WHERE id = $1`,
    [utxoId],
  )
}

export async function spendUtxo(
  pool: Pool,
  utxoId: string,
  txid: string,
  changeVout: number,
  changeValueSats: number,
  jobId: string,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE utxos SET status = 'SPENT', updated_at = NOW() WHERE id = $1`,
      [utxoId],
    )
    await client.query(
      `INSERT INTO utxos (txid, vout, value_sats, status, creating_job_id)
       VALUES ($1, $2, $3, 'UNCONFIRMED', $4)
       ON CONFLICT (txid, vout) DO NOTHING`,
      [txid, changeVout, changeValueSats, jobId],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getPoolDepth(pool: Pool): Promise<PoolDepth> {
  const result = await pool.query<{ available: string; locked: string; unconfirmed: string }>(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'CONFIRMED')   AS available,
      COUNT(*) FILTER (WHERE status = 'LOCKED')      AS locked,
      COUNT(*) FILTER (WHERE status = 'UNCONFIRMED') AS unconfirmed
    FROM utxos
  `)
  const row = result.rows[0]
  return {
    available: Number(row.available),
    locked: Number(row.locked),
    unconfirmed: Number(row.unconfirmed),
  }
}

export async function seedUtxo(pool: Pool, txid: string, vout: number, valueSats: number): Promise<Utxo> {
  const result = await pool.query<Record<string, unknown>>(
    `INSERT INTO utxos (txid, vout, value_sats, status)
     VALUES ($1, $2, $3, 'CONFIRMED')
     ON CONFLICT (txid, vout) DO UPDATE SET value_sats = EXCLUDED.value_sats, updated_at = NOW()
     RETURNING *`,
    [txid, vout, valueSats],
  )
  return parseUtxo(result.rows[0])
}

export async function reclaimStaleLocks(pool: Pool): Promise<void> {
  await pool.query(`
    UPDATE utxos
    SET status = 'CONFIRMED', spending_job_id = NULL, locked_at = NULL, updated_at = NOW()
    WHERE status = 'LOCKED'
      AND locked_at < NOW() - INTERVAL '30 minutes'
      AND id IN (
        SELECT u.id FROM utxos u
        JOIN publish_jobs j ON j.id = u.spending_job_id
        WHERE j.bitcoin_txid IS NULL
      )
  `)
}
