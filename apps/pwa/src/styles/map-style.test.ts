import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const STYLE_PATH = resolve(__dirname, '../../public/sentinelmesh-dark.json')

describe('sentinelmesh-dark.json', () => {
  it('is valid JSON', () => {
    const text = readFileSync(STYLE_PATH, 'utf-8')
    expect(() => JSON.parse(text)).not.toThrow()
  })

  it('has version 8', () => {
    const style = JSON.parse(readFileSync(STYLE_PATH, 'utf-8'))
    expect(style.version).toBe(8)
  })

  it('has at least 20 layers', () => {
    const style = JSON.parse(readFileSync(STYLE_PATH, 'utf-8'))
    expect((style.layers as unknown[]).length).toBeGreaterThanOrEqual(20)
  })

  it('has background layer as first layer', () => {
    const style = JSON.parse(readFileSync(STYLE_PATH, 'utf-8'))
    const layers = style.layers as Array<Record<string, unknown>>
    expect(layers[0].id).toBe('background')
    expect(layers[0].type).toBe('background')
  })

  it('road casing layers appear before road fill layers', () => {
    const style = JSON.parse(readFileSync(STYLE_PATH, 'utf-8'))
    const ids = (style.layers as Array<Record<string, unknown>>).map(l => l.id as string)
    const firstCasing = ids.findIndex(id => id.includes('casing'))
    const firstFill   = ids.findIndex(id => id.startsWith('road-fill'))
    expect(firstCasing).toBeGreaterThanOrEqual(0)
    expect(firstFill).toBeGreaterThan(firstCasing)
  })

  it('contains {MAPTILES_URL} placeholder (substituted at runtime by loadMapStyle)', () => {
    const text = readFileSync(STYLE_PATH, 'utf-8')
    expect(text).toContain('{MAPTILES_URL}')
  })

  it('uses openmaptiles source name', () => {
    const style = JSON.parse(readFileSync(STYLE_PATH, 'utf-8'))
    expect(style.sources).toHaveProperty('openmaptiles')
  })

  it('symbol-sort-key is set on place-label-city', () => {
    const style = JSON.parse(readFileSync(STYLE_PATH, 'utf-8'))
    const layers = style.layers as Array<Record<string, unknown>>
    const cityLayer = layers.find(l => l.id === 'place-label-city')
    expect(cityLayer).toBeDefined()
    const layout = cityLayer!.layout as Record<string, unknown>
    expect(layout['symbol-sort-key']).toBe(1)
  })
})
