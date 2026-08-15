import { afterEach, describe, expect, it, vi } from 'vitest'

describe('feature flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('keeps safe circle location disabled by default', async () => {
    const { safeCircleLocationEnabled } = await import('./features')
    expect(safeCircleLocationEnabled).toBe(false)
  })

  it('requires an explicit true value to enable safe circle location', async () => {
    vi.stubEnv('VITE_ENABLE_SAFE_CIRCLE_LOCATION', 'true')
    const { safeCircleLocationEnabled } = await import('./features')
    expect(safeCircleLocationEnabled).toBe(true)
  })

  it('keeps every experimental feature disabled by default', async () => {
    const { experimentalFeatures } = await import('./features')
    expect(Object.values(experimentalFeatures).every(value => value === false)).toBe(true)
  })

  it('requires an explicit true value to enable an experimental feature', async () => {
    vi.stubEnv('VITE_ENABLE_EXPERIMENTAL_ACOUSTIC', 'true')
    vi.stubEnv('VITE_ENABLE_EXPERIMENTAL_ROUTING', 'false')

    const { experimentalFeatures } = await import('./features')
    expect(experimentalFeatures.acoustic).toBe(true)
    expect(experimentalFeatures.routing).toBe(false)
  })
})
