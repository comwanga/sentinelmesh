// apps/pwa/src/App.tsx
import { useEffect, useCallback, useState } from 'react'
import SafetyMap from './components/SafetyMap'
import { AcousticAlert } from './components/AcousticAlert'
import { FamilyCircleDashboard } from './components/FamilyCircleDashboard'
import { ReportSubmit } from './components/ReportSubmit'
import { ReportList } from './components/ReportList'
import { useWsConnection } from './services/websocket'
import { AudioCapture } from './services/audioCapture'
import { AcousticDetectionService } from './services/acousticDetectionService'
import { autoSubmitAcousticReport } from './services/reportAutoSubmit'
import { detectionReceived, alertDismissed, detectionStarted, detectionStopped } from './store/acousticSlice'
import { useAppDispatch, useAppSelector } from './store'

type View = 'map' | 'circles'
type Panel = 'none' | 'submit' | 'list'

export default function App() {
  useWsConnection()
  const dispatch = useAppDispatch()
  const currentAlert = useAppSelector(s => s.acoustic.currentAlert)
  const [view, setView] = useState<View>('map')
  const [panel, setPanel] = useState<Panel>('none')

  const handleDismiss = useCallback(() => dispatch(alertDismissed()), [dispatch])

  useEffect(() => {
    let capture: AudioCapture | null = null
    let detector: AcousticDetectionService | null = null

    async function start() {
      detector = new AcousticDetectionService((detection) => {
        dispatch(detectionReceived(detection))
        navigator.geolocation?.getCurrentPosition((pos) => {
          autoSubmitAcousticReport(detection, {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          })
        })
      })
      try {
        await detector.init()
        capture = new AudioCapture((samples) => detector?.processWindow(samples))
        await capture.start()
        dispatch(detectionStarted())
      } catch (err) {
        console.warn('[acoustic] detection unavailable:', err)
      }
    }

    start()
    return () => { capture?.stop(); dispatch(detectionStopped()) }
  }, [dispatch])

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', background: '#0B0E14', borderBottom: '1px solid #1a2035', flexShrink: 0 }}>
        {(['map', 'circles'] as View[]).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              padding: '8px 20px',
              background: 'none', border: 'none',
              borderBottom: view === v ? '2px solid #00E5FF' : '2px solid transparent',
              color: view === v ? '#00E5FF' : '#4a5568',
              fontFamily: "'Courier New', monospace", fontSize: 11,
              letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
            }}
          >
            {v === 'map' ? 'Safety Map' : 'Family Circles'}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <AcousticAlert detection={currentAlert} onDismiss={handleDismiss} />
        {view === 'map' && (
          <>
            <SafetyMap />
            <div style={{ position: 'absolute', bottom: 24, right: 16, zIndex: 10, display: 'flex', gap: 8 }}>
              <button
                onClick={() => setPanel(p => p === 'list' ? 'none' : 'list')}
                style={fabStyle('#1565C0')}
              >
                Reports
              </button>
              <button
                onClick={() => setPanel(p => p === 'submit' ? 'none' : 'submit')}
                style={fabStyle('#2E7D32')}
              >
                + Report
              </button>
            </div>
            {panel === 'submit' && (
              <div style={panelStyle}>
                <ReportSubmit onClose={() => setPanel('none')} />
              </div>
            )}
            {panel === 'list' && (
              <div style={panelStyle}>
                <ReportList />
              </div>
            )}
          </>
        )}
        {view === 'circles' && <FamilyCircleDashboard />}
      </div>
    </div>
  )
}

function fabStyle(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', border: 'none', borderRadius: 20,
    padding: '8px 18px', fontSize: 13, cursor: 'pointer',
    fontFamily: 'sans-serif', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  }
}

const panelStyle: React.CSSProperties = {
  position: 'absolute', bottom: 72, right: 16, zIndex: 10,
}
