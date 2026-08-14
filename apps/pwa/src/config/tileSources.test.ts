import { describe, it, expect, vi } from 'vitest'
import { TILE_SOURCE } from './tileSources'

describe('TILE_SOURCE', () => {
  it('uses Stadia OpenMapTiles TileJSON without an API key', () => {
    expect(TILE_SOURCE.stadia).toBe('https://tiles.stadiamaps.com/data/openmaptiles.json')
    expect(TILE_SOURCE.stadia).not.toMatch(/api[_-]?key/i)
  })

  it('uses Stadia glyphs over HTTPS', () => {
    expect(TILE_SOURCE.glyphs).toBe('https://tiles.stadiamaps.com/fonts/{fontstack}/{range}.pbf')
  })

  it('accepts a public build-time TileJSON override', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_MAP_TILE_URL', 'https://maps.example.test/openmaptiles.json')
    const { TILE_SOURCE: overridden } = await import('./tileSources')
    expect(overridden.stadia).toBe('https://maps.example.test/openmaptiles.json')
    vi.unstubAllEnvs()
  })
})
