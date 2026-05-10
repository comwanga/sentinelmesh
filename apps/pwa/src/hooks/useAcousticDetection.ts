import { useEffect } from 'react'
import { useAppDispatch } from '../store'
import { AudioCapture } from '../services/audioCapture'
import { AcousticDetectionService } from '../services/acousticDetectionService'
import { autoSubmitAcousticReport } from '../services/reportAutoSubmit'
import { detectionReceived, detectionStarted, detectionStopped } from '../store/acousticSlice'

export function useAcousticDetection(): void {
  const dispatch = useAppDispatch()

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
    return () => {
      capture?.stop()
      detector = null
      dispatch(detectionStopped())
    }
  }, [dispatch])
}
