import { useState, useEffect } from 'react'
import { useAppSelector, useAppDispatch } from '../store'
import { fetchInsightsEvents } from '../store/insightsEventsSlice'
import { fetchCommunityStats, ReporterStat } from '../store/communityStatsSlice'
import { SafetyLogEntry } from '../store/safetyLogSlice'

type Tab = 'Overview' | 'Heatmap' | 'Personal Safety'
const TABS: Tab[] = ['Overview', 'Heatmap', 'Personal Safety']

export function InsightsPage() {
  const [tab, setTab] = useState<Tab>('Overview')
  const dispatch = useAppDispatch()
  const reporters = useAppSelector(s => s.communityStats.reporters)
  const totalVerified = useAppSelector(s => s.communityStats.totalVerified)
  const safetyLog = useAppSelector(s => s.safetyLog.entries)
  const statsLoading = useAppSelector(s => s.communityStats.loading)

  useEffect(() => {
    const now = new Date()
    const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString()
    dispatch(fetchInsightsEvents({ from, to: now.toISOString(), bucket: '1h' }))
    dispatch(fetchCommunityStats())
  }, [dispatch])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0B0E14' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1a2035', flexShrink: 0 }}>
        <h1 style={{ fontFamily: "'Courier New', monospace", fontSize: 16, color: '#e2e8f0', margin: 0, letterSpacing: '0.1em' }}>
          Insights
        </h1>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid #1a2035', flexShrink: 0, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: tab === t ? '2px solid #00E5FF' : '2px solid transparent',
              color: tab === t ? '#00E5FF' : '#4a5568',
              fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: '0.08em',
              whiteSpace: 'nowrap',
            }}
          >{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {tab === 'Overview' && (
          <div>
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#e2e8f0', marginBottom: 16 }}>
              Total verified reports: <strong>{totalVerified}</strong>
            </div>
            {statsLoading ? (
              <p style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568' }}>Loading...</p>
            ) : reporters.length === 0 ? (
              <p style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568' }}>No community data yet.</p>
            ) : (
              reporters.map((r: any) => (
                <div key={r.pubkey} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1a2035' }}>
                  <span style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#e2e8f0' }}>
                    {r.pubkey.slice(0, 12)}…
                  </span>
                  <span style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#BB86FC' }}>
                    {r.reportCount} reports · {r.tier}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'Heatmap' && (
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#4a5568', textAlign: 'center', marginTop: 40 }}>
            Heatmap requires the /api/events/history backend endpoint.<br />
            Integrate Mapbox heatmap layer once endpoint is live.
          </div>
        )}

        {tab === 'Personal Safety' && (
          <div>
            {safetyLog.length === 0 ? (
              <p style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568' }}>No personal safety events logged yet.</p>
            ) : (
              safetyLog.map((entry: SafetyLogEntry) => (
                <div key={entry.timestamp} style={{ padding: '8px 0', borderBottom: '1px solid #1a2035' }}>
                  <span style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#e2e8f0' }}>{entry.label}</span>
                  <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', marginLeft: 12 }}>
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
