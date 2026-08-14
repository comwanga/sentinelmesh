import { useState, useEffect } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
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
  const buckets = useAppSelector(s => s.insightsEvents.buckets)
  const insightsLoading = useAppSelector(s => s.insightsEvents.loading)

  useEffect(() => {
    const now = new Date()
    const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString()
    dispatch(fetchInsightsEvents({ from, to: now.toISOString(), bucket: '1h' }))
    dispatch(fetchCommunityStats())
  }, [dispatch])

  const chartData = buckets.reduce<Array<{ time: string; count: number }>>((acc, b) => {
    const existing = acc.find(d => d.time === b.bucket)
    if (existing) { existing.count += b.count } else { acc.push({ time: b.bucket, count: b.count }) }
    return acc
  }, []).slice(-24)

  return (
    <div data-testid="insights-page" className="bright-feature page">
      <div className="page-header">
        <h1>Community insights</h1>
        <p>Experimental trend views based on stored events and reports.</p>
      </div>

      <div role="tablist" aria-label="Insights sections" style={{ display: 'flex', borderBottom: '1px solid #1a2035', flexShrink: 0, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            id={`tab-${t.replace(' ', '-')}`}
            aria-controls={`panel-${t.replace(' ', '-')}`}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: tab === t ? '2px solid #00E5FF' : '2px solid transparent',
              color: tab === t ? '#00E5FF' : '#4a5568',
              fontFamily: "'Courier New', monospace", fontSize: 12, letterSpacing: '0.08em',
              whiteSpace: 'nowrap',
            }}
          >{t}</button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab.replace(' ', '-')}`}
        aria-labelledby={`tab-${tab.replace(' ', '-')}`}
        style={{ flex: 1, overflowY: 'auto', padding: 20 }}
      >
        {tab === 'Overview' && (
          <div>
            {insightsLoading ? (
              <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Courier New', monospace", fontSize: 12, color: '#4a5568' }}>
                Loading chart...
              </div>
            ) : chartData.length > 0 ? (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568', marginBottom: 8, letterSpacing: '0.05em' }}>
                  EVENTS — LAST 24H
                </div>
                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="eventGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00E5FF" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#00E5FF" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="time" hide />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{ background: '#0d1118', border: '1px solid #1a2035', fontFamily: "'Courier New', monospace", fontSize: 11 }}
                      itemStyle={{ color: '#00E5FF' }}
                      labelStyle={{ color: '#4a5568' }}
                    />
                    <Area type="monotone" dataKey="count" stroke="#00E5FF" strokeWidth={1.5} fill="url(#eventGradient)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : null}
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#e2e8f0', marginBottom: 16 }}>
              Total verified reports: <strong>{totalVerified}</strong>
            </div>
            {statsLoading ? (
              <p style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#4a5568' }}>Loading...</p>
            ) : reporters.length === 0 ? (
              <p style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#4a5568' }}>No community data yet.</p>
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
              <p style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#4a5568' }}>No personal safety events logged yet.</p>
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
