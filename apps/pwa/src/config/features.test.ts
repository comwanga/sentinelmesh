import { afterEach, describe, expect, it, vi } from 'vitest'

describe('experimental feature flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('does not let the circles experiment enable safe location', async () => {
    vi.stubEnv('VITE_ENABLE_EXPERIMENTAL_CIRCLES', 'true')
    const { experimentalFeatures, safeCircleLocationEnabled } = await import('./features')
    expect(experimentalFeatures.circles).toBe(true)
    expect(safeCircleLocationEnabled).toBe(false)
  })

  it('keeps every experimental feature disabled by default', async () => {
    const { experimentalFeatures } = await import('./features')
    expect(Object.values(experimentalFeatures).every(value => value === false)).toBe(true)
  })

  it('requires an explicit true value to enable a feature', async () => {
    vi.stubEnv('VITE_ENABLE_EXPERIMENTAL_CIRCLES', 'true')
    vi.stubEnv('VITE_ENABLE_EXPERIMENTAL_ROUTING', 'false')

    const { experimentalFeatures } = await import('./features')
    expect(experimentalFeatures.circles).toBe(true)
    expect(experimentalFeatures.routing).toBe(false)
  })
})
