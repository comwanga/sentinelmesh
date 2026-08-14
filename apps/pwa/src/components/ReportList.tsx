import { useCallback } from 'react'
import { useAppDispatch, useAppSelector } from '../store'
import { reportReceived } from '../store/reportSlice'
import { parseReport } from '../services/safetyDataApi'
import { signBoundEvent, voteBindingContent } from '../services/nostrService'
import type { CommunityReport } from '../../../../shared/types'

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? ''

const STATUS_COLORS: Record<string, string> = {
  PENDING:       '#888',
  UNVERIFIED:    '#FF8C00',
  VERIFIED:      '#2E7D32',
  AUTHORITATIVE: '#1565C0',
  DISPUTED:      '#E65100',
  REJECTED:      '#CC0000',
}

export function ReportList() {
  const reports = useAppSelector(s => s.reports.items)
  const dispatch = useAppDispatch()

  const castVote = useCallback(async (report: CommunityReport, vote: 'CONFIRM' | 'DENY') => {
    try {
      const voteEvent = await signBoundEvent(voteBindingContent(vote, report.id))
      let lat: number | null = null
      let lng: number | null = null
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
        )
        lat = pos.coords.latitude
        lng = pos.coords.longitude
      } catch { /* vote without location */ }

      const res = await fetch(`${API_BASE}/api/reports/${report.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          voter_pubkey: voteEvent.pubkey,
          vote,
          voter_nostr_event: voteEvent,
          voter_lat: lat,
          voter_lng: lng,
        }),
      })
      if (!res.ok) console.error(`[vote] server error ${res.status}`)
      else {
        const updated = parseReport(await res.json())
        if (updated) dispatch(reportReceived(updated))
      }
    } catch (err) {
      console.error('[vote] signing or network error', err)
    }
  }, [dispatch])

  if (reports.length === 0) {
    return (
      <div className="report-list">
        <p className="empty-state">
          No community reports yet.
        </p>
      </div>
    )
  }

  return (
    <div className="report-list">
      <h3>Community reports</h3>
      {reports.map(report => (
        <div key={report.id} className="report-card">
          <div className="report-card-head">
            <span className="report-card-title">
              {report.report_type.replace(/_/g, ' ')}
            </span>
            <span className="status-pill" style={{
              background: STATUS_COLORS[report.status] ?? '#888',
            }}>
              {report.status}
            </span>
          </div>

          {report.description && (
            <p>
              {report.description}
            </p>
          )}

          <p className="report-meta">
            {report.place_name ?? `${report.lat.toFixed(4)}, ${report.lng.toFixed(4)}`}
            {' · '}Score: {report.consensus_score}
            {' · '}{report.confirmation_count}✓ {report.denial_count}✗
          </p>

          <div className="vote-actions">
            <button className="confirm" onClick={() => castVote(report, 'CONFIRM')}>
              Confirm
            </button>
            <button className="deny" onClick={() => castVote(report, 'DENY')}>
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
