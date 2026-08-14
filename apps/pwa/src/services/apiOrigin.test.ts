import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('websocketBaseUrl', () => {
  beforeEach(() => vi.resetModules())

  it('uses the current origin by default', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    const { websocketBaseUrl } = await import('./apiOrigin')
    expect(websocketBaseUrl()).toBe('ws://localhost:3000')
    vi.unstubAllEnvs()
  })

  it('converts a configured HTTPS API origin to WSS', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.sentinelmesh.example')
    const { websocketBaseUrl } = await import('./apiOrigin')
    expect(websocketBaseUrl()).toBe('wss://api.sentinelmesh.example')
    vi.unstubAllEnvs()
  })
})
