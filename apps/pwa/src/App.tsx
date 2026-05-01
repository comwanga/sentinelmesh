// apps/pwa/src/App.tsx
import { useEffect, useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import SafetyMap from './components/SafetyMap'
import { AcousticAlert } from './components/AcousticAlert'
import { useWsConnection } from './services/websocket'
import { AudioCapture } from './services/audioCapture'
import { AcousticDetectionService } from './services/acousticDetectionService'
import { autoSubmitAcousticReport } from './services/reportAutoSubmit'
import { detectionReceived, alertDismissed, detectionStarted, detectionStopped } from './store/acousticSlice'
import type { RootState } from './store'

export default function App() {
  useWsConnection()
  const dispatch = useDispatch()
  const currentAlert = useSelector((s: RootState) => s.acoustic.currentAlert)

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
        // Microphone denied or model failed to load — detection is optional
        console.warn('[acoustic] detection unavailable:', err)
      }
    }

    start()

    return () => {
      capture?.stop()
      dispatch(detectionStopped())
    }
  }, [dispatch])

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <AcousticAlert detection={currentAlert} onDismiss={handleDismiss} />
      <SafetyMap />
    </div>
  )
}
