// MapOverlayHost: reads uiIntent, renders AcousticAlert or SafeRouteOverlay
// Intent is consumed reducer-side immediately after setting local overlay state
import { useState, useEffect } from 'react'
import { useAppSelector, useAppDispatch } from '../../store'
import { consumeOverlayIntent } from '../../store/uiSlice'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { AcousticAlert } from '../AcousticAlert'
import { SafeRouteOverlay } from '../SafeRouteOverlay'

export function MapOverlayHost() {
  const dispatch = useAppDispatch()
  const uiIntent = useAppSelector(s => s.ui.uiIntent)
  const { layout } = useBreakpoint()

  const [overlay, setOverlay] = useState<'routes' | 'acoustic' | null>(null)

  useEffect(() => {
    if (uiIntent.name === 'routes' || uiIntent.name === 'acoustic') {
      setOverlay(uiIntent.name)
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

  // overlay === 'routes': render SafeRouteOverlay which draws route lines on the map
  return <SafeRouteOverlay onClose={() => setOverlay(null)} />
}
