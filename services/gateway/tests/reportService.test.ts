import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../src/db/pool', () => ({ getPool: () => ({ query: mockQuery }) }))

import { listReports, rowToReport } from '../src/reports/reportService'

const fakeRow = {
  id: 'r1', report_type: 'FLOODING', description: 'road under water',
  lat: '-1.2921', lng: '36.8219', place_name: 'Mathare',
  nostr_pubkey: 'pk1', nostr_signature: 'sig1', nostr_event_id: 'ev1',
  reporter_tier: 'NEWCOMER', consensus_score: 1, status: 'PENDING',
  confirmation_count: 0, denial_count: 0, photo_ipfs_cid: null,
  linked_event_id: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
}

beforeEach(() => mockQuery.mockReset())

describe('listReports', () => {
  test('maps DB rows to CommunityReport shape', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow], rowCount: 1 })
    const reports = await listReports({})
    expect(reports).toHaveLength(1)
    expect(reports[0]!.report_id).toBe('r1')
    expect(reports[0]!.lat).toBe(-1.2921)
    expect(reports[0]!.created_at).toBe('2026-01-01T00:00:00.000Z')
  })

  test('returns empty array when no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const reports = await listReports({})
    expect(reports).toEqual([])
  })

  test('applies status filter in WHERE clause', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    await listReports({ status: 'verified' })
    const sql: string = mockQuery.mock.calls[0][0]
    expect(sql).toContain('status = ')
    const params: unknown[] = mockQuery.mock.calls[0][1]
    expect(params).toContain('VERIFIED')
  })
})

describe('rowToReport', () => {
  test('converts decimal string lat/lng to numbers', () => {
    const report = rowToReport(fakeRow)
    expect(typeof report.lat).toBe('number')
    expect(typeof report.lng).toBe('number')
  })
})
