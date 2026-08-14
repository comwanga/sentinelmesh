import { describe, it, expect } from 'vitest'
import canonicalStyle from './sentinelmesh-light.json'
import { MAP_STYLE, WORLD_CENTER } from './mapConfig'
import { TILE_SOURCE } from './tileSources'

describe('mapConfig', () => {
  it('exports the world center', () => {
    expect(WORLD_CENTER).toEqual({ longitude: 0, latitude: 20, zoom: 2 })
  })

  it('injects provider URLs structurally into the imported style', () => {
    expect(MAP_STYLE.glyphs).toBe(TILE_SOURCE.glyphs)
    expect(MAP_STYLE.sources.openmaptiles).toMatchObject({ url: TILE_SOURCE.stadia })
    expect(canonicalStyle.glyphs).toBe('{GLYPHS_URL}')
    expect(canonicalStyle.sources.openmaptiles.url).toBe('{TILE_SOURCE}')
  })

  it('contains no unresolved placeholders in the runtime style', () => {
    expect(JSON.stringify(MAP_STYLE)).not.toMatch(/\{(?:GLYPHS_URL|TILE_SOURCE)\}/)
  })
})
