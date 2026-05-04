import { Pool } from 'pg'
import {
  claimUtxo, releaseUtxo, spendUtxo, getPoolDepth, seedUtxo, reclaimStaleLocks, Utxo,
} from '../db/utxoPool'

// Builds a mock pg Pool. queryResults is consumed in call order.
// Calls to pool.connect() return a client whose query() draws from the same sequence.
function makePool(queryResults: Array<{ rows: unknown[] }>): Pool {
  let callIndex = 0
  function nextResult() {
    const result = queryResults[callIndex] ?? { rows: [] }
    callIndex++
    return Promise.resolve(result)
  }
  const client = {
    query: jest.fn().mockImplementation(nextResult),
    release: jest.fn(),
  }
  return {
    connect: jest.fn().mockResolvedValue(client),
    query: jest.fn().mockImplementation(nextResult),
    _client: client,
  } as unknown as Pool
}

const FAKE_UTXO: Utxo = {
  id: 'utxo-uuid',
  txid: 'a'.repeat(64),
  vout: 0,
  value_sats: 50000,
  status: 'CONFIRMED',
  spending_job_id: null,
  creating_job_id: null,
  locked_at: null,
}

describe('claimUtxo', () => {
  it('returns a UTXO and converts value_sats from string to number', async () => {
    const pool = makePool([{ rows: [{ ...FAKE_UTXO, value_sats: '50000' }] }])
    const result = await claimUtxo(pool, 'job-uuid')
    expect(result).not.toBeNull()
    expect(result!.value_sats).toBe(50000)
    expect(typeof result!.value_sats).toBe('number')
  })

  it('returns null when no CONFIRMED UTXO is available', async () => {
    const pool = makePool([{ rows: [] }])
    const result = await claimUtxo(pool, 'job-uuid')
    expect(result).toBeNull()
  })
})

describe('releaseUtxo', () => {
  it('sends UPDATE to restore LOCKED to CONFIRMED', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [] })
    const pool = { query: mockQuery } as unknown as Pool
    await releaseUtxo(pool, 'utxo-uuid')
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'CONFIRMED'"),
      ['utxo-uuid'],
    )
  })
})

describe('spendUtxo', () => {
  it('marks SPENT and inserts UNCONFIRMED change in a transaction', async () => {
    const pool = makePool([
      { rows: [] }, // BEGIN
      { rows: [] }, // UPDATE utxos SET status = 'SPENT'
      { rows: [] }, // INSERT INTO utxos (UNCONFIRMED change)
      { rows: [] }, // COMMIT
    ])
    await spendUtxo(pool, 'utxo-uuid', 'c'.repeat(64), 1, 46920, 'job-uuid')
    const client = (pool as unknown as { _client: { query: jest.Mock } })._client
    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'SPENT'"),
      ['utxo-uuid'],
    )
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("'UNCONFIRMED'"),
      ['c'.repeat(64), 1, 46920, 'job-uuid'],
    )
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })

  it('rolls back if the SPENT update fails', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('db error')) // UPDATE fails
        .mockResolvedValueOnce(undefined), // ROLLBACK
      release: jest.fn(),
    }
    const pool = { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool
    await expect(spendUtxo(pool, 'utxo-uuid', 'c'.repeat(64), 1, 46920, 'job-uuid')).rejects.toThrow('db error')
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
  })
})

describe('getPoolDepth', () => {
  it('returns separate counters as numbers', async () => {
    const pool = makePool([{ rows: [{ available: '2', locked: '1', unconfirmed: '3' }] }])
    const depth = await getPoolDepth(pool)
    expect(depth).toEqual({ available: 2, locked: 1, unconfirmed: 3 })
  })
})

describe('seedUtxo', () => {
  it('inserts a CONFIRMED UTXO and returns it', async () => {
    const pool = makePool([{ rows: [{ ...FAKE_UTXO, value_sats: '100000' }] }])
    const result = await seedUtxo(pool, 'a'.repeat(64), 0, 100000)
    expect(result.status).toBe('CONFIRMED')
    expect(result.value_sats).toBe(100000)
  })
})

describe('reclaimStaleLocks', () => {
  it('issues UPDATE with 30 minute threshold and bitcoin_txid IS NULL check', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [] })
    const pool = { query: mockQuery } as unknown as Pool
    await reclaimStaleLocks(pool)
    const sql = mockQuery.mock.calls[0][0] as string
    expect(sql).toContain('30 minutes')
    expect(sql).toContain('bitcoin_txid IS NULL')
  })
})
