import { Pool } from 'pg'
import { config } from '../config'

let pool: Pool

export async function initPool(): Promise<void> {
  pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })
  // Verify connection at startup
  const client = await pool.connect()
  client.release()
  console.log('PostgreSQL pool connected')
}

export function getPool(): Pool {
  if (!pool) throw new Error('DB pool not initialised — call initPool() first')
  return pool
}
