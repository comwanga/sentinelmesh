import { useMemo } from 'react'
import { WORLD_CENTER } from '../config/mapConfig'

const STORAGE_KEY = 'sentinel_last_viewport'

interface ViewState {
  longitude: number
  latitude: number
  zoom: number
}

// MapLibre supports 0..24; Stadia serves through z14 and MapLibre overzooms beyond it.
export const MIN_VIEWPORT_ZOOM = 0
export const MAX_VIEWPORT_ZOOM = 24

function isViewState(value: unknown): value is ViewState {
  if (!value || typeof value !== 'object') return false
  const { longitude, latitude, zoom } = value as Record<string, unknown>
  return typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && typeof zoom === 'number' && Number.isFinite(zoom) && zoom >= MIN_VIEWPORT_ZOOM && zoom <= MAX_VIEWPORT_ZOOM
}

export function useInitialViewport(): ViewState {
  return useMemo(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed: unknown = JSON.parse(saved)
        if (isViewState(parsed)) return parsed
      }
    } catch { /* Storage can be unavailable or contain invalid JSON. */ }
    return { ...WORLD_CENTER }
  }, [])
}

export function persistViewport(vs: ViewState): void {
  if (!isViewState(vs)) return
  const persisted: ViewState = {
    longitude: vs.longitude,
    latitude: vs.latitude,
    zoom: vs.zoom,
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted)) }
  catch { /* Persistence is best-effort in restricted browser contexts. */ }
}
