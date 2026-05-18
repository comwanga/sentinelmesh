import { useEffect } from 'react'
import type { SafetyEvent } from '../../../../shared/types'
import { SEVERITY_COLORS } from '../styles/map-tokens'

const SIZES: Record<string, number> = {
  CRITICAL: 24,
  HIGH:     20,
  MEDIUM:   16,
  LOW:      12,
}

const BORDER_RING: Record<string, { color: string; width: number } | null> = {
  CRITICAL: { color: 'rgba(255,255,255,0.25)', width: 2 },
  HIGH:     { color: 'rgba(255,255,255,0.20)', width: 1.5 },
  MEDIUM:   { color: 'rgba(255,255,255,0.18)', width: 1.5 },
  LOW:      null,
}

const PULSE_CSS = `
@keyframes sm-border-pulse {
  0%, 100% { opacity: 0.25; }
  50% { opacity: 1.0; }
}
.sm-critical-border { animation: sm-border-pulse 2.5s ease-in-out infinite; }
`

function injectPulseStyles() {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-sm-pulse]')) return
  const el = document.createElement('style')
  el.setAttribute('data-sm-pulse', '')
  el.textContent = PULSE_CSS
  document.head.appendChild(el)
}

interface Props {
  event: SafetyEvent
  onClick: (event: SafetyEvent) => void
}

export default function EventMarker({ event, onClick }: Props) {
  const { severity } = event
  const fill = SEVERITY_COLORS[severity] ?? '#4a5568'
  const size = SIZES[severity] ?? 12
  const ring = BORDER_RING[severity]
  const showExclamation = severity === 'CRITICAL' || severity === 'HIGH'

  useEffect(() => {
    if (severity === 'CRITICAL') injectPulseStyles()
  }, [severity])

  return (
    <div
      onClick={() => onClick(event)}
      style={{
        padding: '8px',
        cursor: 'pointer',
        pointerEvents: 'all',
      }}
      title={event.title}
    >
      <div
        style={{
          position: 'relative',
          background: fill,
          borderRadius: '50%',
          width: `${size}px`,
          height: `${size}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: ring ? `${ring.width}px solid ${ring.color}` : 'none',
        }}
      >
        {ring && severity === 'CRITICAL' && (
          <span
            className="sm-critical-border"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: `${ring.width}px solid ${ring.color}`,
              pointerEvents: 'none',
            }}
          />
        )}
        {showExclamation && (
          <span style={{
            color: 'white',
            fontWeight: 700,
            fontSize: `${Math.max(8, size * 0.5)}px`,
            lineHeight: 1,
            fontFamily: 'monospace',
            userSelect: 'none',
          }}>!</span>
        )}
      </div>
    </div>
  )
}
