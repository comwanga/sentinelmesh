import { useState } from 'react'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { ReportSubmit } from '../components/ReportSubmit'
import { ReportList } from '../components/ReportList'

export function ReportsPage() {
  const { layout } = useBreakpoint()
  const [mobileFormOpen, setMobileFormOpen] = useState(false)

  if (layout === 'desktop') {
    return (
      <div data-testid="reports-container" className="reports-layout">
        <div className="reports-form-column">
          <ReportSubmit onClose={() => {}} />
        </div>
        <div className="reports-list-column">
          <ReportList />
        </div>
      </div>
    )
  }

  return (
    <div data-testid="reports-container" className="page">
      <div className="mobile-page-bar">
        <strong>Community reports</strong>
        <button
          onClick={() => setMobileFormOpen(true)}
          className="button-primary"
        >
          Add report
        </button>
      </div>

      <div className="reports-list-column">
        <ReportList />
      </div>

      {mobileFormOpen && (
        <div className="mobile-sheet-backdrop">
          <div className="mobile-sheet">
            <ReportSubmit onClose={() => setMobileFormOpen(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
