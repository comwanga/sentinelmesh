import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MAP_STYLE_URL, WORLD_CENTER } from './mapConfig'
import { TILE_SOURCE } from './tileSources'

describe('mapConfig', () => {
  it('MAP_STYLE_URL is a non-empty string', () => {
    expect(typeof MAP_STYLE_URL).toBe('string')
    expect(MAP_STYLE_URL.length).toBeGreaterThan(0)
  })

  it('WORLD_CENTER has valid coordinate properties', () => {
    expect(WORLD_CENTER.longitude).toBe(0)
    expect(WORLD_CENTER.latitude).toBe(20)
    expect(WORLD_CENTER.zoom).toBe(2)
  })
})

describe('loadMapStyle injection', () => {
  beforeEach(() => { vi.resetModules() })

  it('replaces {TILE_SOURCE} placeholder with TILE_SOURCE.openfreemap', async () => {
    vi.stubEnv('VITE_MAP_STYLE_URL', '/sentinelmesh-dark.json')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(
        JSON.stringify({
          version: 8,
          sources: { openmaptiles: { type: 'vector', url: '{TILE_SOURCE}' } },
          layers: [],
        })
      ),
    }))

    const { loadMapStyle } = await import('./mapConfig')
    const style = await loadMapStyle() as { sources: { openmaptiles: { url: string } } }
    expect(style.sources.openmaptiles.url).toBe(TILE_SOURCE.openfreemap)

    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('does not leave {TILE_SOURCE} literal in the returned style', async () => {
    vi.stubEnv('VITE_MAP_STYLE_URL', '/sentinelmesh-dark.json')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(
        JSON.stringify({
          version: 8,
          sources: { openmaptiles: { type: 'vector', url: '{TILE_SOURCE}' } },
          layers: [],
        })
      ),
    }))

    const { loadMapStyle } = await import('./mapConfig')
    const style = await loadMapStyle()
    expect(JSON.stringify(style)).not.toContain('{TILE_SOURCE}')

    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('converts the bundled style to the light product palette', async () => {
    vi.stubEnv('VITE_MAP_STYLE_URL', '/sentinelmesh-dark.json')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        version: 8,
        name: 'SentinelMesh Dark',
        sources: { openmaptiles: { type: 'vector', url: '{TILE_SOURCE}' } },
        layers: [{ id: 'background', paint: { 'background-color': '#0B0E14' } }],
      })),
    }))

    const { loadMapStyle } = await import('./mapConfig')
    const style = await loadMapStyle() as { name: string; layers: Array<{ paint: Record<string, string> }> }
    expect(style.name).toBe('SentinelMesh Light')
    expect(style.layers[0]?.paint['background-color']).toBe('#F4F3EC')

    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })
})
