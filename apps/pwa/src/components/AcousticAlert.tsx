import { useEffect } from 'react'
import { useAppSelector, useAppDispatch } from '../store'
import { alertDismissed } from '../store/acousticSlice'
import { useAcousticDetection } from '../hooks/useAcousticDetection'

const CATEGORY_COLOUR: Record<string, string> = {
  SECURITY_INCIDENT: '#FF2D2D',
  FIRE:              '#FF8C00',
  CIVIL_UNREST:      '#FF8C00',
  ACCIDENT:          '#FFD700',
}

interface Props {
  onClose: () => void
}

export function AcousticAlert({ onClose }: Props) {
  useAcousticDetection() // starts only while this overlay is mounted
  const dispatch = useAppDispatch()
  const detection = useAppSelector(s => s.acoustic.currentAlert)
  const running = useAppSelector(s => s.acoustic.running)

  function dismiss() {
    dispatch(alertDismissed())
    onClose()
  }

  useEffect(() => {
    if (!detection) return
    const timer = setTimeout(dismiss, 30_000)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection])

  const bg = CATEGORY_COLOUR[detection?.category ?? ''] ?? '#FF2D2D'

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(11,14,20,0.96)',
    }}>
      {detection ? (
        /* Threat detected state */
        <div style={{
          background: bg, borderRadius: 12, padding: '24px 28px',
          maxWidth: 320, width: '90%',
          boxShadow: `0 0 40px ${bg}66`,
        }}>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 20, fontFamily: "'Courier New', monospace", marginBottom: 8 }}>
            ⚠ {detection.label} DETECTED
          </div>
          <div style={{
            fontSize: 48, fontWeight: 900, color: '#fff',
            fontFamily: "'Courier New', monospace", textAlign: 'center', margin: '16px 0',
          }}>
            {Math.round(detection.confidence * 100)}%
          </div>
          <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontFamily: "'Courier New', monospace", marginBottom: 16 }}>
            Confidence · Community verification submitted
          </div>
          <button
            data-testid="acoustic-dismiss"
            onClick={dismiss}
            style={{
              width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.3)',
              color: '#fff', borderRadius: 6, padding: '8px 0',
              fontFamily: "'Courier New', monospace", fontSize: 12, cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      ) : (
        /* Listening state */
        <div style={{ textAlign: 'center', padding: 32 }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            border: '2px solid #00E5FF',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
            animation: 'pulse 2s ease-in-out infinite',
            fontSize: 32,
          }}>
            🎙
          </div>
          <style>{`@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.7;transform:scale(1.05)} }`}</style>
          <div style={{
            fontFamily: "'Courier New', monospace", fontSize: 14,
            color: '#e2e8f0', marginBottom: 8, fontWeight: 700,
          }}>
            {running ? 'Listening…' : 'Starting microphone…'}
          </div>
          <div style={{
            fontFamily: "'Courier New', monospace", fontSize: 10,
            color: '#4a5568', marginBottom: 24,
          }}>
            Audio never leaves your device
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid #1a2035',
              color: '#4a5568', borderRadius: 6, padding: '8px 20px',
              fontFamily: "'Courier New', monospace", fontSize: 11, cursor: 'pointer',
            }}
          >
            Stop
          </button>
        </div>
      )}
    </div>
  )
}
