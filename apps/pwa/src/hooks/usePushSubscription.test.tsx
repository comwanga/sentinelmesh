import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { signAuth, sha256 } = vi.hoisted(() => ({ signAuth: vi.fn(async () => ({ id: 'auth' })), sha256: vi.fn(async () => 'hash') }))
vi.mock('../services/nostrService', () => ({ signNip98AuthEvent: signAuth, sha256Hex: sha256 }))
import { usePushSubscription } from './usePushSubscription'

const subscription = { endpoint: 'https://push.example/sub', toJSON: () => ({ endpoint: 'https://push.example/sub', keys: { p256dh: 'key', auth: 'auth' } }), unsubscribe: vi.fn(async () => true) }
const requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
const getSubscription = vi.fn(async () => null)
const subscribe = vi.fn(async () => subscription)

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubGlobal('Notification', { permission: 'default', requestPermission })
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 204 })))
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }) } })
})

describe('usePushSubscription', () => {
  test('never requests permission on mount', async () => {
    renderHook(() => usePushSubscription('AQID'))
    await waitFor(() => expect(requestPermission).not.toHaveBeenCalled())
    expect(getSubscription).not.toHaveBeenCalled()
    expect(requestPermission).not.toHaveBeenCalled()
  })

  test('requests permission and sends targeting preferences only after enable', async () => {
    const { result } = renderHook(() => usePushSubscription('AQID'))
    await act(() => result.current.enable({ minSeverity: 'HIGH', radiusKm: 12, center: { lat: -1.29, lng: 36.82 } }))
    expect(requestPermission).toHaveBeenCalledOnce()
    const [, init] = vi.mocked(fetch).mock.calls[0]!
    expect(JSON.parse(String(init?.body))).toMatchObject({ min_severity: 'HIGH', radius_km: 12, center_lat: -1.29, center_lng: 36.82 })
    expect(sha256).toHaveBeenCalledWith(init?.body)
  })
})
