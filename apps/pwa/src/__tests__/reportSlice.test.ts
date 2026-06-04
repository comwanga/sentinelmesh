import { describe, test, expect } from 'vitest'
import reportReducer, { reportReceived } from '../store/reportSlice'
import type { CommunityReport } from '../../../../shared/types'

function makeReport(id: string): CommunityReport {
  return {
    report_id: id, report_type: 'FLOODING', description: null,
    lat: 0, lng: 0, place_name: null,
    reporter_tier: 'NEWCOMER', consensus_score: 1, status: 'PENDING',
    confirmation_count: 0, denial_count: 0, photo_ipfs_cid: null,
    linked_event_id: null, created_at: '', updated_at: '',
  }
}

describe('reportSlice', () => {
  test('initial state is empty', () => {
    const state = reportReducer(undefined, { type: '@@INIT' })
    expect(state.items).toEqual([])
  })

  test('reportReceived prepends new report', () => {
    const state = reportReducer({ items: [] }, reportReceived(makeReport('r1')))
    expect(state.items).toHaveLength(1)
    expect(state.items[0]!.report_id).toBe('r1')
  })

  test('reportReceived updates existing report in-place', () => {
    const initial = { items: [makeReport('r1')] }
    const updated = { ...makeReport('r1'), status: 'VERIFIED' as const }
    const state = reportReducer(initial, reportReceived(updated))
    expect(state.items).toHaveLength(1)
    expect(state.items[0]!.status).toBe('VERIFIED')
  })

  test('caps items at 100', () => {
    const initial = { items: Array.from({ length: 100 }, (_, i) => makeReport(`r${i}`)) }
    const state = reportReducer(initial, reportReceived(makeReport('new')))
    expect(state.items).toHaveLength(100)
    expect(state.items[0]!.report_id).toBe('new')
  })
})
