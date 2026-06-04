import { vi, describe, test, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import reportReducer from '../store/reportSlice'
import type { CommunityReport, ReportStatus } from '../../../../shared/types'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)
vi.stubGlobal('navigator', {
  geolocation: {
    getCurrentPosition: (cb: PositionCallback) =>
      cb({ coords: { latitude: -1.29, longitude: 36.82 } } as GeolocationPosition),
  },
})

vi.mock('../services/nostrService', () => ({
  loadOrCreateKeypair: vi.fn().mockReturnValue({
    publicKey: 'pk1', secretKey: new Uint8Array(32),
  }),
  signReport: vi.fn().mockReturnValue({
    id: 'ev1', pubkey: 'pk1', created_at: 1000, kind: 30078,
    tags: [], content: '{}', sig: 'sig1',
  }),
  voteBindingContent: vi.fn().mockReturnValue('v1|CONFIRM|r1'),
}))

import { ReportList } from './ReportList'

function makeReport(id: string, status: ReportStatus = 'PENDING'): CommunityReport {
  return {
    report_id: id, report_type: 'FLOODING', description: 'road blocked',
    lat: -1.29, lng: 36.82, place_name: 'Mathare',
    reporter_tier: 'NEWCOMER', consensus_score: 1, status,
    confirmation_count: 0, denial_count: 0, photo_ipfs_cid: null,
    linked_event_id: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  }
}

function buildStore(reports: CommunityReport[]) {
  return configureStore({ reducer: { reports: reportReducer }, preloadedState: { reports: { items: reports } } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
})

describe('ReportList', () => {
  test('renders report descriptions', () => {
    const store = buildStore([makeReport('r1'), makeReport('r2')])
    render(<Provider store={store}><ReportList /></Provider>)
    expect(screen.getAllByText('road blocked')).toHaveLength(2)
  })

  test('shows empty state when no reports', () => {
    const store = buildStore([])
    render(<Provider store={store}><ReportList /></Provider>)
    expect(screen.getByText(/no reports/i)).toBeTruthy()
  })

  test('displays status badge', () => {
    const store = buildStore([makeReport('r1', 'VERIFIED')])
    render(<Provider store={store}><ReportList /></Provider>)
    expect(screen.getByText('VERIFIED')).toBeTruthy()
  })

  test('POSTs CONFIRM vote on button click', async () => {
    const store = buildStore([makeReport('r1')])
    render(<Provider store={store}><ReportList /></Provider>)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce())
    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toContain('/api/reports/r1/vote')
  })
})
