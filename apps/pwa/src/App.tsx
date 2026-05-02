// apps/pwa/src/App.tsx
import { useEffect, useCallback, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import SafetyMap from './components/SafetyMap'
import { AcousticAlert } from './components/AcousticAlert'
import { ReportSubmit } from './components/ReportSubmit'
import { ReportList } from './components/ReportList'
import { useWsConnection } from './services/websocket'
import { AudioCapture } from './services/audioCapture'
import { AcousticDetectionService } from './services/acousticDetectionService'
import { autoSubmitAcousticReport } from './services/reportAutoSubmit'
import { detectionReceived, alertDismissed, detectionStarted, detectionStopped } from './store/acousticSlice'
import type { RootState } from './store'

type Panel = 'none' | 'submit' | 'list'

export default function App() {
  useWsConnection()
  const dispatch = useDispatch()
  const currentAlert = useSelector((s: RootState) => s.acoustic.currentAlert)
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
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <AcousticAlert detection={currentAlert} onDismiss={handleDismiss} />
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
