import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerServiceWorker, unregisterServiceWorkers } from './serviceWorker'

describe('service worker lifecycle', () => {
  const update = vi.fn(async () => undefined)
  const unregister = vi.fn(async () => true)
  const register = vi.fn(async () => ({ update }))
  const getRegistrations = vi.fn(async () => [{ unregister }])
  const addEventListener = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: {}, register, getRegistrations, addEventListener },
    })
  })

  it('registers the production worker and checks for an update', async () => {
    registerServiceWorker()
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(register).toHaveBeenCalledWith('/sw.js')
    expect(addEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function))
  })

  it('unregisters production workers during development', async () => {
    unregisterServiceWorkers()
    await vi.waitFor(() => expect(unregister).toHaveBeenCalledOnce())
  })
})
