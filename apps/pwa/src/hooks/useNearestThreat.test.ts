import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import React from 'react'
import { useNearestThreat } from './useNearestThreat'
import eventsReducer, { eventReceived } from '../store/eventsSlice'
import type { SafetyEvent } from '../../../../shared/types'

// Minimal store with only the events slice needed by the hook
function makeStore(events: SafetyEvent[] = []) {
  const s = configureStore({ reducer: { events: eventsReducer } })
  for (const e of events) s.dispatch(eventReceived(e))
  return s
}

function makeWrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(Provider, { store, children })
  }
}

function makeEvent(overrides: Partial<SafetyEvent> = {}): SafetyEvent {
  return {
    id: 'evt-1',
    event_type: 'SECURITY_INCIDENT',
    severity: 'HIGH',
    title: 'Test incident',
    summary: null,
    lat: -1.286,
    lng: 36.817,
    place_name: null,
    county: null,
    is_active: true,
    state: 'ACTIVE',
    started_at: '',
    created_at: '',
    nostr_event_id: null,
    bitcoin_txid: null,
    ...overrides,
  }
}

// Geo mock helpers
type GeoSuccessCallback = (pos: GeolocationPosition) => void
type GeoErrorCallback = (err: GeolocationPositionError) => void

function mockGeo(watchId = 42) {
  let storedCallback: GeoSuccessCallback | null = null
  const clearWatch = vi.fn()
  const watchPosition = vi.fn((cb: GeoSuccessCallback, _errCb?: GeoErrorCallback) => {
    storedCallback = cb
    return watchId
  })
  Object.defineProperty(global.navigator, 'geolocation', {
    writable: true,
    value: { watchPosition, clearWatch },
  })
  function firePosition(lat: number, lng: number) {
    storedCallback?.({
      coords: { latitude: lat, longitude: lng, accuracy: 1, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
      timestamp: Date.now(),
    } as GeolocationPosition)
  }
  return { watchPosition, clearWatch, firePosition }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('useNearestThreat', () => {
  it('returns null when no location is available', () => {
    // watchPosition is registered but no position fired
    mockGeo()
    const store = makeStore([makeEvent()])
    const { result } = renderHook(() => useNearestThreat(), { wrapper: makeWrapper(store) })
    expect(result.current.nearest).toBeNull()
  })

  it('returns null when there are no high-risk events', () => {
    const { firePosition } = mockGeo()
    const store = makeStore([])
    const { result } = renderHook(() => useNearestThreat(), { wrapper: makeWrapper(store) })
    act(() => { firePosition(-1.286, 36.817) })
    expect(result.current.nearest).toBeNull()
  })

  it('returns the nearest event when multiple high-risk events exist', () => {
    const { firePosition } = mockGeo()
    const user = { lat: -1.3, lng: 36.8 }
    const close = makeEvent({ id: 'close', title: 'Close threat', lat: -1.31, lng: 36.81 })
    const far = makeEvent({ id: 'far', title: 'Far threat', lat: -1.5, lng: 37.0 })
    const store = makeStore([close, far])
    const { result } = renderHook(() => useNearestThreat(), { wrapper: makeWrapper(store) })
    act(() => { firePosition(user.lat, user.lng) })
    expect(result.current.nearest?.id).toBe('close')
  })

  it('ignores inactive events (is_active = false)', () => {
    const { firePosition } = mockGeo()
    const inactive = makeEvent({ id: 'inactive', is_active: false })
    const store = makeStore([inactive])
    const { result } = renderHook(() => useNearestThreat(), { wrapper: makeWrapper(store) })
    act(() => { firePosition(-1.286, 36.817) })
    expect(result.current.nearest).toBeNull()
  })

  it('throttles position updates — does not recompute within 1000ms', () => {
    vi.useFakeTimers()
    const { firePosition } = mockGeo()

    // eventA is close to the initial position; eventB is close to the second position
    const eventA = makeEvent({ id: 'a', title: 'Event A', lat: -1.3, lng: 36.8 })
    const eventB = makeEvent({ id: 'b', title: 'Event B', lat: -2.5, lng: 37.9 })
    const store = makeStore([eventA, eventB])
    const { result } = renderHook(() => useNearestThreat(), { wrapper: makeWrapper(store) })

    // Fire first position at t=1000 — accepted, nearest is eventA
    act(() => {
      vi.setSystemTime(1000)
      firePosition(-1.3, 36.8)
    })
    expect(result.current.nearest?.id).toBe('a')

    // Fire second position at t=1500 (only 500ms later, within throttle window) — should be ignored
    act(() => {
      vi.setSystemTime(1500)
      firePosition(-2.5, 37.9)
    })
    // Still returns eventA because the position update was throttled
    expect(result.current.nearest?.id).toBe('a')

    // Advance past the 1000ms window and fire again — now the position should update
    act(() => {
      vi.setSystemTime(2100)
      firePosition(-2.5, 37.9)
    })
    expect(result.current.nearest?.id).toBe('b')

    vi.useRealTimers()
  })

  it('clears watchPosition on unmount', () => {
    const watchId = 99
    const { clearWatch } = mockGeo(watchId)
    const store = makeStore([])
    const { unmount } = renderHook(() => useNearestThreat(), { wrapper: makeWrapper(store) })
    unmount()
    expect(clearWatch).toHaveBeenCalledWith(watchId)
  })

  it('exposes geoError when geolocation fails', () => {
    let storedErrorCb: GeoErrorCallback | null = null
    const clearWatch = vi.fn()
    const watchPosition = vi.fn((_cb: GeoSuccessCallback, errCb?: GeoErrorCallback) => {
      storedErrorCb = errCb ?? null
      return 1
    })
    Object.defineProperty(global.navigator, 'geolocation', {
      writable: true,
      value: { watchPosition, clearWatch },
    })
    const store = makeStore([])
    const { result } = renderHook(() => useNearestThreat(), { wrapper: makeWrapper(store) })
    expect(result.current.geoError).toBeNull()
    act(() => {
      storedErrorCb?.({ code: 1, message: 'Permission denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError)
    })
    expect(result.current.geoError).not.toBeNull()
    expect(result.current.geoError?.code).toBe(1)
  })
})
