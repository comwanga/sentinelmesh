import { useEffect } from 'react'
import { useAppDispatch } from '../store'
import { detectionReceived, detectionStarted, detectionStopped } from '../store/acousticSlice'
import { AudioCapture } from '../services/audioCapture'
import { AcousticDetectionService } from '../services/acousticDetectionService'
import { submitAcousticSignal } from '../services/acousticSignalSubmit'

export function useAcousticEngine() {
  const dispatch = useAppDispatch()

  useEffect(() => {
    let capture: AudioCapture | null = null
    let detector: AcousticDetectionService | null = null

    async function start() {
      detector = new AcousticDetectionService((detection) => {
        dispatch(detectionReceived(detection))
        navigator.geolocation?.getCurrentPosition(
          (pos) => {
            submitAcousticSignal(detection, { lat: pos.coords.latitude, lng: pos.coords.longitude })
              .catch(err => console.warn('[acoustic] signal submission failed:', err))
          },
          undefined,
          { maximumAge: 5000 },
        )
      })
      try {
        await detector.init()
        capture = new AudioCapture(samples => detector?.processWindow(samples))
        await capture.start()
        dispatch(detectionStarted())
      } catch (err) {
        console.warn('[acoustic] detection unavailable:', err)
      }
    }

    start()

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        capture?.stop()
        dispatch(detectionStopped())
      }
    }

    function handleBeforeUnload() {
      capture?.stop()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      capture?.stop()
      detector = null
      dispatch(detectionStopped())
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [dispatch])
}
