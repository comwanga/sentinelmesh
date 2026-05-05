import { useBreakpoint } from '../hooks/useBreakpoint'
import { ReportSubmit } from '../components/ReportSubmit'
import { ReportList } from '../components/ReportList'

export function ReportsPage() {
  const { layout } = useBreakpoint()

  return (
    <div style={{
      display: 'flex',
      flexDirection: layout === 'desktop' ? 'row' : 'column',
      gap: 16,
      padding: 16,
      height: '100%',
      overflow: 'hidden',
      background: '#0B0E14',
    }}>
      <div style={{ flex: layout === 'desktop' ? '0 0 360px' : '0 0 auto' }}>
        <ReportSubmit onClose={() => {}} />
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <ReportList />
      </div>
    </div>
  )
}
