import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')

describe('HTML entrypoint', () => {
  it('index.html does not contain Mapbox CSS link', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8')
    expect(html).not.toContain('mapbox.com')
  })

  it('index.html contains map-overlay-portal div', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8')
    expect(html).toContain('id="map-overlay-portal"')
  })

  it('main.tsx imports maplibre-gl CSS', () => {
    const main = readFileSync(resolve(__dirname, 'main.tsx'), 'utf-8')
    expect(main).toContain("maplibre-gl/dist/maplibre-gl.css")
  })

  it('mounts React before hydrating signer state and handles hydration failures', () => {
    const main = readFileSync(resolve(__dirname, 'main.tsx'), 'utf-8')
    expect(main.indexOf('ReactDOM.createRoot')).toBeLessThan(main.indexOf('loadIdentity()'))
    expect(main).toContain('.then(initializeActiveSigner).catch(')
    expect(main).not.toContain('.finally(')
  })
})
