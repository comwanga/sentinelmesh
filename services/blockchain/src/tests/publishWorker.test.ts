import { Pool } from 'pg'

// Mock config before the publishWorker module is loaded so process.exit is never called.
jest.mock('../config', () => ({
  config: {
    port: 3003,
    databaseUrl: 'postgres://test',
    nostrPrivkey: '0'.repeat(64),
    relayUrls: ['wss://relay.test'],
    bitcoinWif: 'test-wif',
    bitcoinNetwork: 'testnet',
    pollIntervalMs: 10000,
  },
}))

// Mock db/pool so getPool() does not throw during module load.
jest.mock('../db/pool', () => ({
  getPool: jest.fn(),
}))

// Mock nostrPublisher to avoid ESM-only @noble/curves dependency.
jest.mock('../workers/nostrPublisher', () => ({
  publishNostrEvents: jest.fn(),
}))

// Mock bitcoinAnchor to avoid bitcoinjs-lib native deps in unit tests.
jest.mock('../workers/bitcoinAnchor', () => ({
  broadcastAnchor: jest.fn(),
  PreBroadcastError: class PreBroadcastError extends Error {
    constructor(msg: string) { super(msg); this.name = 'PreBroadcastError' }
  },
  PostBroadcastError: class PostBroadcastError extends Error {
    constructor(msg: string, public txid: string, public changeVout: number, public changeValue: number) {
      super(msg); this.name = 'PostBroadcastError'
    }
  },
}))

jest.mock('../db/utxoPool', () => ({
  claimUtxo: jest.fn(),
  releaseUtxo: jest.fn(),
  spendUtxo: jest.fn(),
  reclaimStaleLocks: jest.fn(),
}))

jest.mock('../utils/feeEstimator', () => ({
  estimateFee: jest.fn().mockResolvedValue(3080),
}))

import { claimNextJob, markFailed, markDead, PublishJob } from '../workers/publishWorker'
import { releaseJobForRetry } from '../workers/publishWorker'
import { claimUtxo, releaseUtxo, spendUtxo } from '../db/utxoPool'
import { PreBroadcastError, PostBroadcastError } from '../workers/bitcoinAnchor'

const mockClaimUtxo = claimUtxo as jest.Mock
const mockReleaseUtxo = releaseUtxo as jest.Mock
const mockSpendUtxo = spendUtxo as jest.Mock

// Minimal mock of pg Pool
function makePool(queryResults: Array<{ rows: unknown[] }>): Pool {
  let callIndex = 0
  const client = {
    query: jest.fn().mockImplementation(() => {
      const result = queryResults[callIndex] ?? { rows: [] }
      callIndex++
      return Promise.resolve(result)
    }),
    release: jest.fn(),
  }
  return {
    connect: jest.fn().mockResolvedValue(client),
    query: jest.fn().mockImplementation(() => {
      const result = queryResults[callIndex] ?? { rows: [] }
      callIndex++
      return Promise.resolve(result)
    }),
  } as unknown as Pool
}

const FAKE_JOB: PublishJob = {
  id: 'job-uuid',
  source_type: 'SAFETY_EVENT',
  source_id: 'event-uuid',
  status: 'PENDING',
  nostr_kind1_id: null,
  nostr_kind30078_id: null,
  bitcoin_txid: null,
  anchor_hash: null,
  retry_count: 0,
}

describe('claimNextJob', () => {
  it('returns null when no job is available', async () => {
    const pool = makePool([
      { rows: [] }, // BEGIN
      { rows: [] }, // UPDATE ... RETURNING (no rows)
      { rows: [] }, // COMMIT
    ])
    const result = await claimNextJob(pool, 'worker-1')
    expect(result).toBeNull()
  })

  it('returns the claimed job when one is available', async () => {
    const pool = makePool([
      { rows: [] },           // BEGIN
      { rows: [FAKE_JOB] },  // UPDATE ... RETURNING
      { rows: [] },           // COMMIT
    ])
    const result = await claimNextJob(pool, 'worker-1')
    expect(result).toMatchObject({ id: 'job-uuid', status: 'PENDING' })
  })
})

describe('markFailed', () => {
  it('updates status to FAILED with exponential backoff', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [] })
    const pool = { query: mockQuery } as unknown as Pool

    await markFailed(pool, 'job-uuid', 'relay error', 2)

    // First call: UPDATE publish_jobs
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FAILED'),
      expect.arrayContaining(['job-uuid', 'relay error']),
    )
    // Should also insert into publish_failures
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('publish_failures'),
      expect.arrayContaining(['job-uuid']),
    )
  })
})

describe('markDead', () => {
  it('sets status to DEAD', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [] })
    const pool = { query: mockQuery } as unknown as Pool

    await markDead(pool, 'job-uuid')

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DEAD'),
      ['job-uuid'],
    )
  })
})

describe('releaseJobForRetry', () => {
  it('sets job back to PENDING with 1-minute delay without touching retry_count', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ rows: [] })
    const pool = { query: mockQuery } as unknown as Pool
    await releaseJobForRetry(pool, 'job-uuid')
    const sql = mockQuery.mock.calls[0][0] as string
    expect(sql).toContain("status = 'PENDING'")
    expect(sql).toContain('1 minute')
    expect(sql).not.toContain('retry_count')
  })
})
