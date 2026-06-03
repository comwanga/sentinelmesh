import { useCallback } from 'react'
import { useAppSelector } from '../store'
import { loadOrCreateKeypair, signReport, voteBindingContent } from '../services/nostrService'
import { VerificationBadges } from './VerificationBadges'
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

  const castVote = useCallback(async (report: CommunityReport, vote: 'CONFIRM' | 'DENY') => {
    const keypair = loadOrCreateKeypair()
    const voteEvent = signReport(voteBindingContent(vote, report.report_id), keypair.secretKey)

    let lat: number | null = null
    let lng: number | null = null
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
      )
      lat = pos.coords.latitude
      lng = pos.coords.longitude
    } catch { /* vote without location */ }

    try {
      const res = await fetch(`${API_BASE}/api/reports/${report.report_id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          voter_pubkey: keypair.publicKey,
          vote,
          voter_nostr_event: voteEvent,
          voter_lat: lat,
          voter_lng: lng,
        }),
      })
      if (!res.ok) console.error(`[vote] server error ${res.status}`)
    } catch (err) {
      console.error('[vote] network error', err)
    }
  }, [])

  if (reports.length === 0) {
    return (
      <div style={containerStyle}>
        <p style={{ fontFamily: 'sans-serif', fontSize: 13, color: '#888', textAlign: 'center' }}>
          No reports in your area yet.
        </p>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <h3 style={{ margin: '0 0 12px', fontSize: 14, fontFamily: 'sans-serif' }}>Community Reports</h3>
      {reports.map(report => (
        <div key={report.report_id} style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontFamily: 'sans-serif', fontSize: 12, fontWeight: 600 }}>
              {report.report_type.replace(/_/g, ' ')}
            </span>
            <span style={{
              background: STATUS_COLORS[report.status] ?? '#888',
              color: '#fff', fontSize: 10, padding: '2px 6px',
              borderRadius: 8, fontFamily: 'sans-serif',
            }}>
              {report.status}
            </span>
          </div>

          {report.description && (
            <p style={{ margin: '4px 0', fontSize: 12, fontFamily: 'sans-serif', color: '#333' }}>
              {report.description}
            </p>
          )}

          <p style={{ margin: '2px 0 6px', fontSize: 10, color: '#888', fontFamily: 'sans-serif' }}>
            {report.place_name ?? `${report.lat.toFixed(4)}, ${report.lng.toFixed(4)}`}
            {' · '}Score: {report.consensus_score}
            {' · '}{report.confirmation_count}✓ {report.denial_count}✗
          </p>

          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => castVote(report, 'CONFIRM')} style={voteBtnStyle('#2E7D32')}>
              Confirm
            </button>
            <button onClick={() => castVote(report, 'DENY')} style={voteBtnStyle('#CC0000')}>
              Deny
            </button>
          </div>

          <VerificationBadges
            nostrEventId={report.nostr_event_id}
            bitcoinTxid={null}
          />
        </div>
      ))}
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 8, padding: 12,
  boxShadow: '0 2px 12px rgba(0,0,0,0.15)', maxHeight: '60vh',
  overflowY: 'auto', width: 320,
}
const cardStyle: React.CSSProperties = {
  borderBottom: '1px solid #eee', paddingBottom: 10, marginBottom: 10,
}
function voteBtnStyle(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', border: 'none', borderRadius: 4,
    padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'sans-serif',
  }
}
