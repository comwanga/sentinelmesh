import { Pool } from 'pg'
import { config } from '../config'

let _pool: Pool | null = null

export function getPool(): Pool {
  if (!_pool) throw new Error('Pool not initialized — call initPool() first')
  return _pool
}

export async function initPool(): Promise<void> {
  _pool = new Pool({ connectionString: config.databaseUrl })
  await _pool.query('SELECT 1')
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end()
    _pool = null
  }
}
