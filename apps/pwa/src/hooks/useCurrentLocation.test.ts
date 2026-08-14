import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCurrentLocation } from './useCurrentLocation'

describe('useCurrentLocation', () => {
  let success: (position: GeolocationPosition) => void
  let failure: (error: GeolocationPositionError) => void
  const watchPosition = vi.fn((next: (position: GeolocationPosition) => void, error: (error: GeolocationPositionError) => void) => { success = next; failure = error; return 7 })
  const clearWatch = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition, clearWatch } })
  })

  it('does not watch before activation and follows the first fix', () => {
    const { result } = renderHook(() => useCurrentLocation())
    expect(watchPosition).not.toHaveBeenCalled()
    act(() => result.current.startFollowing())
    expect(result.current.status).toBe('requesting')
    expect(watchPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.objectContaining({ enableHighAccuracy: true }))
    act(() => success({ coords: { latitude: 1, longitude: 2, accuracy: 3 } } as GeolocationPosition))
    expect(result.current.status).toBe('following')
    expect(result.current.location).toEqual({ lat: 1, lng: 2, accuracy: 3 })
  })

  it('pauses follow while retaining updates and resumes with the latest fix', () => {
    const { result } = renderHook(() => useCurrentLocation())
    act(() => result.current.startFollowing())
    act(() => success({ coords: { latitude: 1, longitude: 2, accuracy: 3 } } as GeolocationPosition))
    act(() => result.current.stopFollowing())
    act(() => success({ coords: { latitude: 4, longitude: 5, accuracy: 6 } } as GeolocationPosition))
    expect(result.current.status).toBe('located-not-following')
    expect(result.current.location?.lat).toBe(4)
    act(() => result.current.startFollowing())
    expect(result.current.status).toBe('following')
    expect(watchPosition).toHaveBeenCalledOnce()
  })

  it('reports permission denial and clears watches on disable and unmount', () => {
    const first = renderHook(() => useCurrentLocation())
    act(() => first.result.current.startFollowing())
    act(() => failure({ code: 1, PERMISSION_DENIED: 1, message: 'denied' } as GeolocationPositionError))
    expect(first.result.current.status).toBe('denied')
    first.unmount()

    const second = renderHook(() => useCurrentLocation())
    act(() => second.result.current.startFollowing())
    act(() => second.result.current.disable())
    expect(clearWatch).toHaveBeenCalledWith(7)
    second.unmount()
  })
})
