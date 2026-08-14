import { describe, it, expect } from 'vitest'
import style from '../config/sentinelmesh-light.json'

const layers = style.layers as Array<Record<string, unknown>>
const ids = layers.map(layer => layer.id as string)
const layer = (id: string) => layers.find(candidate => candidate.id === id)!

describe('canonical SentinelMesh light style', () => {
  it('is a substantial version 8 bright style in app source', () => {
    expect(style.version).toBe(8)
    expect(style.name).toBe('SentinelMesh Light')
    expect(layers.length).toBeGreaterThanOrEqual(30)
    expect(layer('background').paint).toMatchObject({ 'background-color': '#f8f6f1' })
    expect(layer('water').paint).toMatchObject({ 'fill-color': '#c9e5f2' })
    expect(layer('parks').paint).toMatchObject({ 'fill-color': '#dcebd6' })
  })

  it('keeps source and glyph injection explicit', () => {
    expect(style.glyphs).toBe('{GLYPHS_URL}')
    expect(style.sources.openmaptiles.url).toBe('{TILE_SOURCE}')
  })

  it('contains required attribution and no obsolete providers', () => {
    const text = JSON.stringify(style)
    expect(text).toContain('Stadia Maps')
    expect(text).toContain('OpenMapTiles')
    expect(text).toContain('OpenStreetMap')
    expect(text).not.toMatch(/OpenFreeMap|openfreemap|demotiles\.maplibre/i)
  })

  it('draws every road casing before road fills with local street classes', () => {
    const casingIndexes = ids.map((id, index) => id.startsWith('road-casing') ? index : -1).filter(index => index >= 0)
    const fillIndexes = ids.map((id, index) => id.startsWith('road-fill') ? index : -1).filter(index => index >= 0)
    expect(Math.max(...casingIndexes)).toBeLessThan(Math.min(...fillIndexes))
    expect(JSON.stringify(layer('road-fill-local').filter)).toMatch(/residential.*living_street/)
  })

  it('shows outlined buildings from zoom 13 and labels buildings later', () => {
    expect(layer('building-fill').minzoom).toBe(13)
    expect(layer('building-outline').minzoom).toBe(13)
    expect(ids.indexOf('building-outline')).toBeLessThan(ids.indexOf('building-label'))
  })

  it('provides road, place, building, airport and text-only useful POI labels', () => {
    expect(ids).toEqual(expect.arrayContaining([
      'road-label-major', 'road-label-local', 'building-label', 'airport-label',
      'place-label-neighbourhood', 'place-label-locality', 'place-label-city', 'place-label-country',
    ]))
    const poi = JSON.stringify(layer('poi-useful'))
    for (const category of ['hospital', 'police', 'fire_station', 'pharmacy', 'school', 'fuel', 'bus', 'railway', 'airport', 'town_hall']) {
      expect(poi).toContain(category)
    }
    expect(poi).not.toContain('icon-image')
    expect(style).not.toHaveProperty('sprite')
  })
})
