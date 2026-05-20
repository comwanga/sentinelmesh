import { TILE_SOURCE } from './tileSources'

export const MAP_STYLE_URL: string =
  (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ??
  'https://demotiles.maplibre.org/style.json'

export const WORLD_CENTER = { longitude: 0, latitude: 20, zoom: 2 } as const

export async function loadMapStyle(): Promise<object | string> {
  const styleUrl = MAP_STYLE_URL
  if (!styleUrl || styleUrl.startsWith('http') || styleUrl.startsWith('//')) {
    return styleUrl
  }
  const res = await fetch(styleUrl)
  if (!res.ok) throw new Error(`Map style fetch failed: ${res.status} ${styleUrl}`)
  const style = JSON.parse(await res.text()) as {
    sources?: Record<string, { url?: string }>
  }
  if (style.sources?.openmaptiles) {
    style.sources.openmaptiles.url = TILE_SOURCE.openfreemap
  }
  return style
}
