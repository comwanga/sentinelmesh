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
    return React.createElement(Provider, { store }, children)
  }
}

function makeEvent(overrides: Partial<SafetyEvent> = {}): SafetyEvent {
  return {
    event_id: 'evt-1',
    event_type: 'SECURITY_INCIDENT',
    severity: 'HIGH',
    title: 'Test incident',
    summary: null,
    location: { place_name: null, lat: -1.286, lng: 36.817, county: null },
    confidence: 0.8,
    source_count: 1,
    source_breakdown: {},
    is_active: true,
    started_at: '',
    last_updated: '',
    nostr_event_id: null,
    bitcoin_txid: null,
    ...overrides,
  }
}

// Geo mock helpers
type GeoCallback = (pos: GeolocationPosition) => void

function mockGeo(watchId = 42) {
  let storedCallback: GeoCallback | null = null
  const clearWatch = vi.fn()
  const watchPosition = vi.fn((cb: GeoCallback) => {
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
    expect(result.current).toBeNull()
  })

  it('returns null when there are no high-risk events', () => {
    const { firePosition } = mockGeo()
    const store = makeStore([])
    const { result } = renderHook(() => useNearestThreat(), { wrapper: makeWrapper(store) })
    act(() => { firePosition(-1.286, 36.817) })
    expect(result.current).toBeNull()
  })

  it('returns the nearest event when multiple high-risk events exist', () => {
    const { firePosition } = mockGeo()
    const user = { lat: -1.3, lng: 36.8 }
    const close = makeEvent({ event_id: 'close', title: 'Close threat', location: { place_name: null, lat: -1.31, lng: 36.81, county: null } })
    const far = makeEvent({ event_id: 'far', title: 'Far threat', location: { place_name: null, lat: -1.5, lng: 37.0, county: null } })
    const store = makeStore([close, far])
    const { result } = renderHook(() => useNearestThreat(), { wrapper: makeWrapper(store) })
    act(() => { firePosition(user.lat, user.lng) })
    expect(result.current?.event_id).toBe('close')
  })

  it('ignores low-confidence events (confidence < 0.7)', () => {
    const { firePosition } = mockGeo()
    const lowConf = makeEvent({ event_id: 'low', confidence: 0.5, location: { place_name: null, lat: -1.286, lng: 36.817, county: null } })
    const store = makeStore([lowConf])
    const { result } = renderHook(() => useNearestThreat(), { wrapper: makeWrapper(store) })
    act(() => { firePosition(-1.286, 36.817) })
    expect(result.current).toBeNull()
  })

  it('ignores inactive events (is_active = false)', () => {
    const { firePosition } = mockGeo()
    const inactive = makeEvent({ event_id: 'inactive', is_active: false, location: { place_name: null, lat: -1.286, lng: 36.817, county: null } })
    const store = makeStore([inactive])
    const { result } = renderHook(() => useNearestThreat(), { wrapper: makeWrapper(store) })
    act(() => { firePosition(-1.286, 36.817) })
    expect(result.current).toBeNull()
  })

  it('throttles position updates — does not recompute within 1000ms', () => {
    // Use a controlled clock so we can verify the throttle without real time
    vi.useFakeTimers()
    const { firePosition } = mockGeo()
    const eventA = makeEvent({ event_id: 'a', title: 'Event A', location: { place_name: null, lat: -1.3, lng: 36.8, county: null } })
    const store = makeStore([eventA])
    const { result } = renderHook(() => useNearestThreat(), { wrapper: makeWrapper(store) })

    // Fire the first position update — should be accepted
    act(() => {
      vi.setSystemTime(1000)
      firePosition(-1.3, 36.8)
    })
    expect(result.current?.event_id).toBe('a')

    // Fire again within 1000ms — should be ignored (state should not change)
    act(() => {
      vi.setSystemTime(1500) // only 500ms later
      firePosition(-2.0, 37.5)
    })
    // Still returns event 'a' because the position did not update
    expect(result.current?.event_id).toBe('a')

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
})
