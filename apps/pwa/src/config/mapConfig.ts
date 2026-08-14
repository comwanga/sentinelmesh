import type { StyleSpecification } from 'maplibre-gl'
import canonicalStyle from './sentinelmesh-light.json'
import { TILE_SOURCE } from './tileSources'

export const WORLD_CENTER = { longitude: 0, latitude: 20, zoom: 2 } as const

export const MAP_STYLE = {
  ...canonicalStyle,
  glyphs: TILE_SOURCE.glyphs,
  sources: {
    ...canonicalStyle.sources,
    openmaptiles: {
      ...canonicalStyle.sources.openmaptiles,
      url: TILE_SOURCE.stadia,
    },
  },
} as unknown as StyleSpecification
