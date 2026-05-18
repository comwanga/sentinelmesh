import { useMemo } from 'react'
import { WORLD_CENTER } from '../config/mapConfig'

const STORAGE_KEY = 'sentinel_last_viewport'

interface ViewState {
  longitude: number
  latitude: number
  zoom: number
}

export function useInitialViewport(): ViewState {
  return useMemo(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try { return JSON.parse(saved) as ViewState }
      catch { /* corrupted */ }
    }
    return { ...WORLD_CENTER }
  }, [])
}

export function persistViewport(vs: ViewState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vs))
}
