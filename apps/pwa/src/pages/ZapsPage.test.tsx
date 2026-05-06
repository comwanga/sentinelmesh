import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from '../store/eventsSlice'
import acousticReducer from '../store/acousticSlice'
import reportsReducer, { reportReceived } from '../store/reportSlice'
import circlesReducer from '../store/circlesSlice'
import uiReducer from '../store/uiSlice'
import zapsReducer, { zapSent, ZapRecord } from '../store/zapsSlice'
import { ZapsPage } from './ZapsPage'
import type { CommunityReport } from '../../../../shared/types'

// Mock ZapButton to a simple button so tests don't hit fetch
vi.mock('../components/ZapButton', () => ({
  ZapButton: ({ reportId }: { reportId: string }) => (
    <button data-testid={`zap-btn-${reportId}`}>ZAP</button>
  ),
}))

function makeTestStore(
  reports: CommunityReport[] = [],
  zapRecords: ZapRecord[] = [],
) {
  const store = configureStore({
    reducer: {
      events: eventsReducer,
      acoustic: acousticReducer,
      reports: reportsReducer,
      circles: circlesReducer,
      ui: uiReducer,
      zaps: zapsReducer,
    },
  })
  reports.forEach(r => store.dispatch(reportReceived(r)))
  zapRecords.forEach(z => store.dispatch(zapSent(z)))
  return store
}

function makeReport(overrides: Partial<CommunityReport> & { report_id: string }): CommunityReport {
  return {
    report_id: overrides.report_id,
    report_type: overrides.report_type ?? 'SECURITY_INCIDENT',
    description: null,
    lat: -1.286,
    lng: 36.817,
    place_name: overrides.place_name ?? 'Nairobi CBD',
    nostr_pubkey: overrides.nostr_pubkey ?? 'npub1testpubkey',
    nostr_signature: 'sig',
    nostr_event_id: null,
    reporter_tier: 'TRUSTED',
    consensus_score: 0.8,
    status: 'VERIFIED',
    confirmation_count: 3,
    denial_count: 0,
    photo_ipfs_cid: null,
    linked_event_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeZapRecord(overrides: Partial<ZapRecord> & { id: string }): ZapRecord {
  return {
    id: overrides.id,
    amount: overrides.amount ?? 21,
    recipientPubkey: overrides.recipientPubkey ?? 'npub1abc',
    reportId: overrides.reportId ?? 'report-1',
    timestamp: overrides.timestamp ?? Date.now(),
    ...overrides,
  }
}

function renderPage(reports: CommunityReport[] = [], zapRecords: ZapRecord[] = []) {
  const store = makeTestStore(reports, zapRecords)
  render(
    <Provider store={store}>
      <ZapsPage />
    </Provider>
  )
  return store
}

describe('ZapsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders "ZAP REPORTER" heading', () => {
    renderPage()
    expect(screen.getByText('ZAP REPORTER')).toBeInTheDocument()
  })

  it('renders "SEND ZAP" and "ZAP HISTORY" section headers', () => {
    renderPage()
    expect(screen.getByText('SEND ZAP')).toBeInTheDocument()
    expect(screen.getByText('ZAP HISTORY')).toBeInTheDocument()
  })

  it('shows community reports in Send Zap section', () => {
    const reports = [
      makeReport({ report_id: 'r1', report_type: 'ROAD_BLOCKED', place_name: 'Westlands' }),
      makeReport({ report_id: 'r2', report_type: 'FLOODING', place_name: 'Kibera' }),
    ]
    renderPage(reports)

    // Report type names rendered with underscores replaced by spaces
    expect(screen.getByText('ROAD BLOCKED')).toBeInTheDocument()
    expect(screen.getByText('FLOODING')).toBeInTheDocument()
    // Each report has a ZapButton (mocked)
    expect(screen.getByTestId('zap-btn-r1')).toBeInTheDocument()
    expect(screen.getByTestId('zap-btn-r2')).toBeInTheDocument()
  })

  it('shows zap records in Zap History section', () => {
    const zapRecords = [
      makeZapRecord({ id: 'z1', amount: 100, recipientPubkey: 'npub1abcdef', reportId: 'r1', timestamp: Date.now() }),
      makeZapRecord({ id: 'z2', amount: 500, recipientPubkey: 'npub1xyz', reportId: 'r2', timestamp: Date.now() }),
    ]
    renderPage([], zapRecords)

    expect(screen.getByTestId('zap-record-z1')).toBeInTheDocument()
    expect(screen.getByTestId('zap-record-z2')).toBeInTheDocument()
    expect(screen.getByText('100 sats')).toBeInTheDocument()
    expect(screen.getByText('500 sats')).toBeInTheDocument()
  })

  it('shows "No zaps sent yet" when no zap records exist', () => {
    renderPage()
    expect(screen.getByText('No zaps sent yet')).toBeInTheDocument()
  })

  it('dispatches zapSent action when ZapButton wrapper is clicked', () => {
    const report = makeReport({
      report_id: 'r1',
      report_type: 'SECURITY_INCIDENT',
      nostr_pubkey: 'npub1reporter',
    })
    const store = renderPage([report])

    // Click the mocked ZapButton (wrapped in an onClick div in ReportRow)
    fireEvent.click(screen.getByTestId('zap-btn-r1'))

    // The dispatch should have added a record to zaps
    const state = store.getState()
    expect(state.zaps.records).toHaveLength(1)
    expect(state.zaps.records[0]!.reportId).toBe('r1')
    expect(state.zaps.records[0]!.recipientPubkey).toBe('npub1reporter')
    expect(state.zaps.records[0]!.amount).toBe(21)
  })
})
