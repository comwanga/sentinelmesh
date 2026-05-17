import { useState } from 'react'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { ReportSubmit } from '../components/ReportSubmit'
import { ReportList } from '../components/ReportList'

export function ReportsPage() {
  const { layout } = useBreakpoint()
  const [mobileFormOpen, setMobileFormOpen] = useState(false)

  if (layout === 'desktop') {
    return (
      <div data-testid="reports-container" style={{
        display: 'flex', flexDirection: 'row', gap: 16,
        padding: 16, height: '100%', overflow: 'hidden', background: '#0B0E14',
      }}>
        <div style={{ flex: '0 0 340px', overflowY: 'auto' }}>
          <ReportSubmit onClose={() => {}} />
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <ReportList />
        </div>
      </div>
    )
  }

  return (
    <div data-testid="reports-container" style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      overflow: 'hidden', background: '#0B0E14',
    }}>
      {/* Mobile header bar with submit button */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid #1a2035',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#e2e8f0', letterSpacing: '0.08em' }}>
          REPORTS
        </span>
        <button
          onClick={() => setMobileFormOpen(true)}
          style={{
            background: '#1B5E20', border: '1px solid #4CAF50', borderRadius: 5,
            color: '#4CAF50', fontFamily: "'Courier New', monospace", fontSize: 11,
            padding: '6px 14px', cursor: 'pointer', letterSpacing: '0.05em',
          }}
        >
          + SUBMIT
        </button>
      </div>

      {/* Report list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        <ReportList />
      </div>

      {/* Slide-up modal */}
      {mobileFormOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(11,14,20,0.85)',
          display: 'flex', alignItems: 'flex-end',
        }}>
          <div style={{
            width: '100%', background: '#0B0E14',
            border: '1px solid #1a2035', borderRadius: '14px 14px 0 0',
            padding: '16px 14px 32px', maxHeight: '85vh', overflowY: 'auto',
          }}>
            <ReportSubmit onClose={() => setMobileFormOpen(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
