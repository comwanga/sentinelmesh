import { describe, it, expect, vi } from 'vitest'

vi.mock('maplibre-gl', () => ({
  default: { addProtocol: vi.fn() },
}))
vi.mock('pmtiles', () => ({
  Protocol: class { tile() {} },
}))

import { MAP_STYLE_URL, WORLD_CENTER } from './mapConfig'

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
