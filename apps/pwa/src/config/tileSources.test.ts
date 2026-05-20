import { describe, it, expect } from 'vitest'
import { TILE_SOURCE } from './tileSources'

describe('TILE_SOURCE', () => {
  it('openfreemap is the OpenFreeMap planet TileJSON endpoint', () => {
    expect(TILE_SOURCE.openfreemap).toBe('https://tiles.openfreemap.org/planet')
  })

  it('openfreemap URL is HTTPS', () => {
    expect(TILE_SOURCE.openfreemap).toMatch(/^https:\/\//)
  })
})
