import { createSelector } from '@reduxjs/toolkit'
import { useAppSelector } from '../store'
import type { RootState } from '../store'
import type { Severity } from '../../../../shared/types'

const SEVERITY_COLOURS: Record<Severity, string> = {
  CRITICAL: '#FF2D2D',
  HIGH: '#FF8C00',
  MEDIUM: '#FFD700',
  LOW: '#4CAF50',
}

const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

const selectEventsBySeverity = createSelector(
  (state: RootState) => state.events.items,
  items => {
    const counts: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
    items.forEach(e => { if (e.is_active) counts[e.severity]++ })
    return counts
  }
)

export function InsightsPage() {
  const counts = useAppSelector(selectEventsBySeverity)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <div
      data-testid="insights-page"
      style={{
        padding: 24, height: '100%', background: '#0B0E14',
        fontFamily: 'sans-serif', overflowY: 'auto',
      }}
    >
      <h2 style={{ color: '#e2e8f0', margin: '0 0 24px', fontSize: 16, fontWeight: 600 }}>
        Insights
      </h2>

      <div style={{ marginBottom: 24 }}>
        <div style={{
          color: '#4a5568', fontSize: 11, fontFamily: "'Courier New', monospace",
          letterSpacing: '0.1em', marginBottom: 12,
        }}>
          ACTIVE EVENTS BY SEVERITY
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SEVERITIES.map(severity => {
            const count = counts[severity]
            return (
              <div key={severity} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{
                  color: SEVERITY_COLOURS[severity], width: 72, fontSize: 11,
                  fontFamily: "'Courier New', monospace",
                }}>
                  {severity}
                </span>
                <div style={{
                  flex: 1, background: '#1a2035', borderRadius: 4, height: 8, overflow: 'hidden',
                }}>
                  <div style={{
                    width: total > 0 ? `${(count / total) * 100}%` : '0%',
                    background: SEVERITY_COLOURS[severity], height: '100%',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <span style={{ color: '#e2e8f0', width: 24, textAlign: 'right', fontSize: 13 }}>
                  {count}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ color: '#4a5568', fontSize: 12 }}>
        Detailed analytics coming soon.
      </div>
    </div>
  )
}
