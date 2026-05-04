import { useAppSelector } from '../store'
import { VerificationBadges } from './VerificationBadges'

export default function ReportList() {
  const reports = useAppSelector(state => state.reports.items)

  if (reports.length === 0) {
    return (
      <p style={{ fontFamily: 'sans-serif', fontSize: 13, color: '#666', padding: '8px 0' }}>
        No reports yet.
      </p>
    )
  }

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {reports.map(report => (
        <li
          key={report.report_id}
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 8,
            fontFamily: 'sans-serif',
            fontSize: 13,
          }}
        >
          <strong style={{ color: '#333' }}>{report.event_type}</strong>
          <span
            style={{
              marginLeft: 8,
              fontSize: 11,
              color: '#888',
              textTransform: 'uppercase',
            }}
          >
            {report.severity}
          </span>
          {report.description && (
            <p style={{ margin: '4px 0 0', color: '#555' }}>{report.description}</p>
          )}
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#999' }}>
            {new Date(report.submitted_at).toLocaleString()}
          </p>
          <VerificationBadges
            nostrEventId={report.nostr_event_id}
            bitcoinTxid={undefined}
          />
        </li>
      ))}
    </ul>
  )
}
