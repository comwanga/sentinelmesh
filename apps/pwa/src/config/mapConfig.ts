import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'

const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol))

export const MAP_STYLE_URL: string =
  (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ??
  'https://demotiles.maplibre.org/style.json'

export const MAPTILES_URL: string =
  (import.meta.env.VITE_MAPTILES_URL as string | undefined) ?? ''

export const WORLD_CENTER = { longitude: 0, latitude: 20, zoom: 2 } as const

export async function loadMapStyle(): Promise<object | string> {
  const styleUrl = MAP_STYLE_URL
  if (!styleUrl || styleUrl.startsWith('http') || styleUrl.startsWith('//')) {
    return styleUrl
  }
  const res = await fetch(styleUrl)
  if (!res.ok) throw new Error(`Map style fetch failed: ${res.status} ${styleUrl}`)
  const text = await res.text()
  return JSON.parse(text.replaceAll('{MAPTILES_URL}', MAPTILES_URL))
}
