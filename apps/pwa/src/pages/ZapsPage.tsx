import { useCallback } from 'react'
import { useAppSelector, useAppDispatch } from '../store'
import { selectZapRecords, sendZap } from '../store/zapsSlice'
import { ZapButton } from '../components/ZapButton'
import type { CommunityReport } from '../../../../shared/types'

// How many milliseconds ago a timestamp was, formatted as a short string
function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// Truncate a pubkey to a readable short form
function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 16) return pubkey
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`
}

const cardStyle: React.CSSProperties = {
  background: '#111622',
  border: '1px solid #1a2035',
  borderRadius: 6,
  padding: '10px 12px',
  marginBottom: 8,
}

const labelStyle: React.CSSProperties = {
  fontFamily: "'Courier New', monospace",
  fontSize: 10,
  color: '#4a5568',
  letterSpacing: '0.05em',
}

const valueStyle: React.CSSProperties = {
  fontFamily: "'Courier New', monospace",
  fontSize: 12,
  color: '#e2e8f0',
}

interface ReportRowProps {
  report: CommunityReport
  onZapSent: (report: CommunityReport) => void
}

function ReportRow({ report, onZapSent }: ReportRowProps) {
  const handleZapSent = useCallback(() => {
    onZapSent(report)
  }, [report, onZapSent])

  return (
    <div style={cardStyle} data-testid={`report-row-${report.report_id}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...valueStyle, fontSize: 13, fontWeight: 700, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {report.report_type.replace(/_/g, ' ')}
          </div>
          <div style={{ ...labelStyle, marginBottom: 2 }}>
            {report.place_name ?? `${report.lat.toFixed(4)}, ${report.lng.toFixed(4)}`}
          </div>
          <div style={labelStyle}>
            {new Date(report.created_at).toLocaleTimeString()}
          </div>
        </div>
        <div onClick={handleZapSent} style={{ flexShrink: 0 }}>
          <ZapButton reportId={report.report_id} amountSats={21} />
        </div>
      </div>
    </div>
  )
}

export function ZapsPage() {
  const dispatch = useAppDispatch()
  const reports = useAppSelector(s => s.reports.items)
  const zapRecords = useAppSelector(selectZapRecords)

  const handleZapSent = useCallback((report: CommunityReport) => {
    dispatch(sendZap({
      reportId: report.report_id,
      recipientPubkey: report.nostr_pubkey,
      amountSats: 21,
    }))
  }, [dispatch])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#0B0E14', overflow: 'hidden',
    }}>
      {/* Page header */}
      <div style={{
        padding: '12px 16px 10px',
        borderBottom: '1px solid #1a2035',
      }}>
        <h1 style={{
          margin: 0,
          fontFamily: "'Courier New', monospace",
          fontSize: 15, fontWeight: 700,
          color: '#00E5FF', letterSpacing: '0.1em',
        }}>
          ZAP REPORTER
        </h1>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>

        {/* Section 1: Send Zap */}
        <div style={{ marginBottom: 24 }}>
          <h2 style={{
            margin: '0 0 10px',
            fontFamily: "'Courier New', monospace",
            fontSize: 12, fontWeight: 700,
            color: '#BB86FC', letterSpacing: '0.08em',
          }}>
            SEND ZAP
          </h2>

          {reports.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '24px 0',
              fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568',
            }}>
              NO REPORTS AVAILABLE
            </div>
          ) : (
            reports.map(report => (
              <ReportRow
                key={report.report_id}
                report={report}
                onZapSent={handleZapSent}
              />
            ))
          )}
        </div>

        {/* Section 2: Zap History */}
        <div>
          <h2 style={{
            margin: '0 0 10px',
            fontFamily: "'Courier New', monospace",
            fontSize: 12, fontWeight: 700,
            color: '#BB86FC', letterSpacing: '0.08em',
          }}>
            ZAP HISTORY
          </h2>

          {zapRecords.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '24px 0',
              fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568',
            }}>
              No zaps sent yet
            </div>
          ) : (
            zapRecords.map(record => (
              <div key={record.id} style={cardStyle} data-testid={`zap-record-${record.id}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div>
                    <span style={{ ...valueStyle, color: '#F7931A', fontWeight: 700 }}>
                      {record.amount} sats
                    </span>
                    <span style={{ ...labelStyle, marginLeft: 8 }}>
                      {timeAgo(record.timestamp)}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={labelStyle}>
                      {truncatePubkey(record.recipientPubkey)}
                    </div>
                    <div style={{ ...labelStyle, fontSize: 9 }}>
                      {record.reportId}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
