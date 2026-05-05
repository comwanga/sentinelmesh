// MapOverlayHost: reads uiIntent, renders AcousticAlert or a safe-route panel
// Intent is consumed reducer-side immediately after setting local overlay state
import { useState, useEffect } from 'react'
import { useAppSelector, useAppDispatch } from '../../store'
import { consumeOverlayIntent } from '../../store/uiSlice'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { AcousticAlert } from '../AcousticAlert'

export function MapOverlayHost() {
  const dispatch = useAppDispatch()
  const uiIntent = useAppSelector(s => s.ui.uiIntent)
  const { layout } = useBreakpoint()

  const [overlay, setOverlay] = useState<'routes' | 'acoustic' | null>(null)

  useEffect(() => {
    if (uiIntent.name === 'routes' || uiIntent.name === 'acoustic') {
      setOverlay(uiIntent.name as 'routes' | 'acoustic')
      dispatch(consumeOverlayIntent())
    }
  }, [uiIntent.name, dispatch])

  const presentation: 'panel' | 'sheet' | 'fullscreen' =
    layout === 'desktop' ? 'panel' : overlay === 'acoustic' ? 'fullscreen' : 'sheet'

  if (!overlay) return null

  if (overlay === 'acoustic') {
    return (
      <div style={
        presentation === 'fullscreen'
          ? { position: 'fixed', inset: 0, zIndex: 200, pointerEvents: 'none' }
          : { position: 'absolute', inset: 0, zIndex: 200, pointerEvents: 'none' }
      }>
        <AcousticAlert onClose={() => setOverlay(null)} />
      </div>
    )
  }

  // overlay === 'routes': show an informational panel (SafeRouteOverlay is a Mapbox layer
  // and must live inside <Map>; this host provides the dismiss-able UI wrapper)
  const panelStyle: React.CSSProperties = presentation === 'panel'
    ? {
        position: 'fixed',
        top: 64,
        right: 328,
        width: 280,
        zIndex: 200,
      }
    : {
        position: 'fixed',
        bottom: 60,
        left: 0,
        right: 0,
        zIndex: 200,
      }

  return (
    <div style={{
      ...panelStyle,
      background: '#0B0E14',
      border: '1px solid #1a2035',
      borderRadius: 8,
      padding: '12px 14px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 12,
          fontWeight: 700,
          color: '#00E5FF',
          letterSpacing: '0.08em',
        }}>
          SAFE ROUTES
        </span>
        <button
          onClick={() => setOverlay(null)}
          aria-label="Close safe routes panel"
          style={{
            background: 'none',
            border: 'none',
            color: '#4a5568',
            fontSize: 16,
            cursor: 'pointer',
            padding: 0,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
      <p style={{
        fontFamily: "'Courier New', monospace",
        fontSize: 11,
        color: '#e2e8f0',
        margin: 0,
      }}>
        Safe escape routes are displayed on the map. Follow the highlighted paths to move away from the incident zone.
      </p>
    </div>
  )
}
