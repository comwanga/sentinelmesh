import { Pool } from 'pg'

const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

// Import after mocking fetch
import { pollOnce } from '../workers/confirmationPoller'

beforeEach(() => mockFetch.mockReset())

// Builds a mock pool that returns results in call order from a shared sequence.
function makePool(queryResults: Array<{ rows: unknown[] }>): Pool {
  let callIndex = 0
  return {
    query: jest.fn().mockImplementation(() => {
      const result = queryResults[callIndex] ?? { rows: [] }
      callIndex++
      return Promise.resolve(result)
    }),
  } as unknown as Pool
}

const FAKE_UTXO_ROW = { id: 'utxo-uuid', txid: 'tx1'.padEnd(64, '0'), created_at: new Date().toISOString() }
const FAKE_JOB_ROW = {
  id: 'job-uuid',
  txid: 'tx1'.padEnd(64, '0'),
  source_type: 'SAFETY_EVENT',
  source_id: 'event-uuid',
}

describe('pollOnce', () => {
  it('deduplicates txids — only one fetch for two UTXOs sharing a txid', async () => {
    const pool = makePool([
      { rows: [FAKE_UTXO_ROW, { ...FAKE_UTXO_ROW, id: 'utxo-uuid-2' }] },  // UNCONFIRMED utxos
      { rows: [] },  // BITCOIN_ANCHORED jobs
    ])
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: async () => '' })
    await pollOnce(pool, 'testnet')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('updates utxo to CONFIRMED, job to COMPLETE, writes bitcoin_block on confirmation', async () => {
    const pool = makePool([
      { rows: [FAKE_UTXO_ROW] },   // UNCONFIRMED utxos
      { rows: [FAKE_JOB_ROW] },    // BITCOIN_ANCHORED jobs
      { rows: [] },                 // UPDATE utxos CONFIRMED
      { rows: [] },                 // UPDATE publish_jobs COMPLETE
      { rows: [] },                 // UPDATE safety_events bitcoin_block
    ])
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: { confirmed: true, block_height: 850000 } }),
    })
    const mockQuery = (pool as unknown as { query: jest.Mock }).query
    await pollOnce(pool, 'testnet')
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'CONFIRMED'"),
      [FAKE_UTXO_ROW.id],
    )
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'COMPLETE'"),
      [FAKE_JOB_ROW.id],
    )
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('bitcoin_block'),
      ['event-uuid', 850000],
    )
  })

  it('marks job FAILED and inserts publish_failure on 404', async () => {
    const pool = makePool([
      { rows: [] },              // UNCONFIRMED utxos
      { rows: [FAKE_JOB_ROW] }, // BITCOIN_ANCHORED jobs
      { rows: [] },              // UPDATE publish_jobs FAILED
      { rows: [] },              // INSERT publish_failures
    ])
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    const mockQuery = (pool as unknown as { query: jest.Mock }).query
    await pollOnce(pool, 'testnet')
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'FAILED'"),
      expect.arrayContaining([FAKE_JOB_ROW.id]),
    )
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('publish_failures'),
      expect.arrayContaining([FAKE_JOB_ROW.id]),
    )
  })

  it('skips txid on 5xx — no DB writes', async () => {
    const pool = makePool([
      { rows: [FAKE_UTXO_ROW] },
      { rows: [] },
    ])
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 })
    const mockQuery = (pool as unknown as { query: jest.Mock }).query
    const initialCallCount = mockQuery.mock.calls.length
    await pollOnce(pool, 'testnet')
    // Only the two SELECT queries + no update queries
    const writeCalls = mockQuery.mock.calls.slice(initialCallCount).filter(
      ([sql]: [string]) => sql.includes('UPDATE') || sql.includes('INSERT')
    )
    expect(writeCalls).toHaveLength(0)
  })

  it('logs WARN for stuck transactions older than 24h without confirming', async () => {
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    const pool = makePool([
      { rows: [{ ...FAKE_UTXO_ROW, created_at: oldDate }] },
      { rows: [] },
    ])
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: { confirmed: false } }),
    })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    await pollOnce(pool, 'testnet')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('stuck transaction'), expect.any(String))
    warnSpy.mockRestore()
  })
})
