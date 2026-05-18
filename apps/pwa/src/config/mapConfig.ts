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
