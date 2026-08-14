import { TILE_SOURCE } from './tileSources'

export const MAP_STYLE_URL: string =
  (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) ??
  'https://demotiles.maplibre.org/style.json'

export const WORLD_CENTER = { longitude: 0, latitude: 20, zoom: 2 } as const

const LIGHT_STYLE_COLORS: Record<string, string> = {
  '#0B0E14': '#F4F3EC', '#163c5e': '#BDE3EE', '#152e1a': '#DCEAD5',
  '#111f2e': '#ECEBE4', '#131e32': '#EEE4D7', '#141e2e': '#DDDCD4',
  '#1e2d44': '#CBC9BE', '#2e4d6e': '#A8B9B4', '#243d58': '#C4CECA',
  '#111827': '#D4D2C8', '#5a7da8': '#F2C975', '#4e6e96': '#F5D994',
  '#3d5c84': '#FFFFFF', '#304e72': '#FFFFFF', '#243d5e': '#F9F8F3',
  '#1a2a3e': '#F7F6F1', '#6b8daa': '#526864', '#5d7fa0': '#617572',
  '#3d5878': '#687C78', '#527a9e': '#0B6B61', '#3d5470': '#617572',
  '#7a9ab5': '#3D5D59', '#a8b8cc': '#173D3A', '#8fa8c4': '#48635E',
}

function lightMapStyle(text: string): object {
  let light = text
  for (const [dark, replacement] of Object.entries(LIGHT_STYLE_COLORS)) {
    light = light.replaceAll(dark, replacement)
  }
  const style = JSON.parse(light) as { name?: string }
  style.name = 'SentinelMesh Light'
  return style
}

export async function loadMapStyle(): Promise<object | string> {
  const styleUrl = MAP_STYLE_URL
  if (!styleUrl || styleUrl.startsWith('http') || styleUrl.startsWith('//')) {
    return styleUrl
  }
  const res = await fetch(styleUrl)
  if (!res.ok) throw new Error(`Map style fetch failed: ${res.status} ${styleUrl}`)
  const style = lightMapStyle(await res.text()) as {
    sources?: Record<string, { url?: string }>
  }
  if (style.sources?.openmaptiles) {
    style.sources.openmaptiles.url = TILE_SOURCE.openfreemap
  }
  return style
}
