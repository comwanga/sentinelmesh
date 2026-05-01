// apps/pwa/src/components/AcousticAlert.tsx
import { useEffect } from 'react'
import { ThreatDetection } from '../constants/acousticThreats'

const CATEGORY_COLOUR: Record<string, string> = {
  SECURITY_INCIDENT: '#FF2D2D',
  FIRE:              '#FF8C00',
  CIVIL_UNREST:      '#FF8C00',
  ACCIDENT:          '#FFD700',
}

interface Props {
  detection: ThreatDetection | null
  onDismiss: () => void
}

export function AcousticAlert({ detection, onDismiss }: Props) {
  useEffect(() => {
    if (!detection) return
    const timer = setTimeout(onDismiss, 30_000)
    return () => clearTimeout(timer)
  }, [detection, onDismiss])

  if (!detection) return null

  const bg = CATEGORY_COLOUR[detection.category] ?? '#FF2D2D'

  return (
    <div style={{
      position: 'absolute', top: 56, left: 12, right: 12, zIndex: 20,
      background: bg, borderRadius: 8, padding: '12px 16px',
      display: 'flex', alignItems: 'flex-start', gap: 12,
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 15, fontFamily: 'sans-serif' }}>
          ⚠ {detection.label} detected nearby
        </div>
        <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12, marginTop: 3, fontFamily: 'sans-serif' }}>
          Confidence: {Math.round(detection.confidence * 100)}%
        </div>
        <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 4, fontFamily: 'sans-serif' }}>
          Submitted for community verification. Stay alert.
        </div>
      </div>
      <button
        data-testid="acoustic-dismiss"
        onClick={onDismiss}
        style={{
          background: 'none', border: 'none', color: '#fff',
          fontSize: 20, fontWeight: 700, cursor: 'pointer', padding: 0,
        }}
      >
        ✕
      </button>
    </div>
  )
}
