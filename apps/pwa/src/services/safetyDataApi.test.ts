import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchInitialEvents, fetchInitialReports, parseEvent, parseReport } from './safetyDataApi'

afterEach(() => vi.unstubAllGlobals())

describe('safetyDataApi', () => {
  it('defaults missing trust evidence to heuristic', () => {
    const event = parseEvent({
      id: 'event-1', event_type: 'FLOOD', severity: 'HIGH', title: 'Flood',
      lat: -1.2, lng: 36.8, started_at: '2026-01-01T00:00:00Z',
    })
    expect(event?.trust_state).toBe('heuristic')
    expect(event?.created_at).toBe('2026-01-01T00:00:00Z')
  })

  it('requires the server report id contract', () => {
    expect(parseReport({ report_id: 'legacy', report_type: 'FIRE', status: 'PENDING' })).toBeNull()
    expect(parseReport({
      id: 'report-1', report_type: 'FIRE', status: 'PENDING', lat: 0, lng: 0,
      reporter_tier: 'NEWCOMER', consensus_score: 0, confirmation_count: 0,
      denial_count: 0, created_at: '', updated_at: '',
    })?.id).toBe('report-1')
  })

  it('hydrates event and report envelopes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [{
        id: 'event-1', event_type: 'FIRE', severity: 'HIGH', title: 'Fire',
        lat: 0, lng: 0, started_at: '2026-01-01T00:00:00Z',
      }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ reports: [{
        id: 'report-1', report_type: 'FIRE', status: 'PENDING', lat: 0, lng: 0,
        reporter_tier: 'NEWCOMER', consensus_score: 0, confirmation_count: 0,
        denial_count: 0, created_at: '', updated_at: '',
      }] })))
    vi.stubGlobal('fetch', fetchMock)

    expect((await fetchInitialEvents())[0]!.id).toBe('event-1')
    expect((await fetchInitialReports())[0]!.id).toBe('report-1')
  })
})
