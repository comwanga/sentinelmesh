import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAppSelector, useAppDispatch } from '../../store'
import { consumeOverlayIntent, safeRoutesCleared } from '../../store/uiSlice'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { AcousticAlert } from '../AcousticAlert'
import { HomeRoutePanel } from '../HomeRoutePanel'

export function MapOverlayHost() {
  const dispatch = useAppDispatch()
  const uiIntent = useAppSelector(s => s.ui.uiIntent)
  const { layout } = useBreakpoint()

  const [overlay, setOverlay] = useState<'routes' | 'acoustic' | 'home-route' | null>(null)

  useEffect(() => {
    if (uiIntent.name === 'routes' || uiIntent.name === 'acoustic' || uiIntent.name === 'home-route') {
      setOverlay(uiIntent.name)
      dispatch(consumeOverlayIntent())
    }
  }, [uiIntent.name, dispatch])

  const portalRoot = typeof document !== 'undefined'
    ? document.getElementById('map-overlay-portal')
    : null

  if (!overlay) return null
  if (!portalRoot) return null

  let content: React.ReactNode = null

  if (overlay === 'acoustic') {
    content = (
      <div style={{
        position: 'absolute',
        inset: 0,
        zIndex: 200,
        pointerEvents: layout !== 'desktop' ? 'all' : 'none',
      }}>
        <AcousticAlert onClose={() => setOverlay(null)} />
      </div>
    )
  } else if (overlay === 'home-route') {
    content = (
      <div style={{
        position: 'absolute',
        top: layout === 'mobile' ? 'auto' : 12,
        bottom: layout === 'mobile' ? 120 : 'auto',
        right: 12,
        zIndex: 200,
        pointerEvents: 'all',
      }}>
        <HomeRoutePanel location={null} locationStatus="idle" onClose={() => setOverlay(null)} />
      </div>
    )
  } else {
    // overlay === 'routes': close button; route lines drawn by SafeRouteOverlay inside MapCanvas
    content = (
      <div style={{
        position: 'absolute', top: 8, right: 44, zIndex: 300,
        pointerEvents: 'all',
        background: 'rgba(11,14,20,0.88)', border: '1px solid #1a2035',
        borderRadius: 6, padding: '5px 12px',
        fontFamily: "'Courier New', monospace", fontSize: 10, color: '#00C853',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span>Escape routes active</span>
        <button
          onClick={() => { setOverlay(null); dispatch(safeRoutesCleared()) }}
          style={{ background: 'none', border: 'none', color: '#4a5568', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}
        >
          ×
        </button>
      </div>
    )
  }

  return createPortal(content, portalRoot)
}
