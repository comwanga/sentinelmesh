import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import type { ReactNode } from 'react'
import viewportEventsReducer, {
  viewportEventsSet,
  viewportEventsBatchApply,
} from '../../store/viewportEventsSlice'
import { useViewportWs } from '../useViewportWs'
import type { ViewportBounds } from '../useViewportWs'
import type { SafetyEvent } from '../../../../../shared/types'

// --- MockWebSocket ---
class MockWebSocket {
  static instances: MockWebSocket[] = []
  readyState = 0
  url: string
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) { this.sent.push(data) }
  close(code = 1000) {
    this.readyState = 3
    this.onclose?.({ code })
  }

  simulateOpen() { this.readyState = 1; this.onopen?.() }
  simulateMessage(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
  simulateClose(code = 1006) { this.readyState = 3; this.onclose?.({ code }) }
}

function makeStore() {
  return configureStore({ reducer: { viewportEvents: viewportEventsReducer } })
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  )
}

const bounds: ViewportBounds = { north: 0, south: -2, east: 37, west: 35 }

const wsEvent = {
  id: 'e1', event_type: 'FLOOD', severity: 'HIGH', state: 'ACTIVE',
  title: 'Flooding', lat: -1.29, lng: 36.82, started_at: '2026-05-18T00:00:00Z',
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useViewportWs', () => {
  it('connects to /ws/events', () => {
    const store = makeStore()
    renderHook(() => useViewportWs(bounds, 12), { wrapper: wrapper(store) })
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0]!.url).toContain('/ws/events')
  })

  it('sends SUBSCRIBE on open when bounds are available', () => {
    const store = makeStore()
    renderHook(() => useViewportWs(bounds, 12), { wrapper: wrapper(store) })
    const ws = MockWebSocket.instances[0]!
    act(() => ws.simulateOpen())
    expect(ws.sent).toHaveLength(1)
    const msg = JSON.parse(ws.sent[0]!)
    expect(msg.type).toBe('SUBSCRIBE')
    expect(msg.bounds.south).toBe(-2)
    expect(msg.bounds.north).toBe(0)
    expect(msg.bounds.west).toBe(35)
    expect(msg.bounds.east).toBe(37)
    expect(msg.zoom).toBe(12)
  })

  it('does not send SUBSCRIBE on open when bounds are null', () => {
    const store = makeStore()
    renderHook(() => useViewportWs(null, 12), { wrapper: wrapper(store) })
    const ws = MockWebSocket.instances[0]!
    act(() => ws.simulateOpen())
    expect(ws.sent).toHaveLength(0)
  })

  it('sends SUBSCRIBE when bounds arrive after WS is already open', () => {
    const store = makeStore()
    let currentBounds: ViewportBounds | null = null
    const { rerender } = renderHook(
      () => useViewportWs(currentBounds, 12),
      { wrapper: wrapper(store) },
    )
    const ws = MockWebSocket.instances[0]!
    act(() => ws.simulateOpen())
    expect(ws.sent).toHaveLength(0)

    currentBounds = bounds
    act(() => rerender())
    expect(ws.sent).toHaveLength(1)
    expect(JSON.parse(ws.sent[0]!).type).toBe('SUBSCRIBE')
  })

  it('sends VIEWPORT_CHANGED when bounds change after SUBSCRIBE', () => {
    const store = makeStore()
    let currentBounds = bounds
    const { rerender } = renderHook(
      () => useViewportWs(currentBounds, 12),
      { wrapper: wrapper(store) },
    )
    const ws = MockWebSocket.instances[0]!
    act(() => ws.simulateOpen())
    ws.sent = []

    currentBounds = { north: 1, south: -1, east: 38, west: 36 }
    act(() => rerender())
    expect(ws.sent).toHaveLength(1)
    expect(JSON.parse(ws.sent[0]!).type).toBe('VIEWPORT_CHANGED')
  })

  it('dispatches viewportEventsSet on INITIAL_BATCH', () => {
    const store = makeStore()
    renderHook(() => useViewportWs(bounds, 12), { wrapper: wrapper(store) })
    const ws = MockWebSocket.instances[0]!
    act(() => ws.simulateOpen())
    act(() => ws.simulateMessage({ type: 'INITIAL_BATCH', events: [wsEvent] }))
    expect(store.getState().viewportEvents.items).toHaveLength(1)
    expect(store.getState().viewportEvents.items[0]!.id).toBe('e1')
  })

  it('dispatches viewportEventsSet on SNAPSHOT', () => {
    const store = makeStore()
    renderHook(() => useViewportWs(bounds, 12), { wrapper: wrapper(store) })
    const ws = MockWebSocket.instances[0]!
    act(() => ws.simulateOpen())
    act(() => ws.simulateMessage({ type: 'SNAPSHOT', events: [wsEvent] }))
    expect(store.getState().viewportEvents.items).toHaveLength(1)
  })

  it('dispatches viewportEventsBatchApply on DIFF_PATCH', () => {
    const store = makeStore()
    renderHook(() => useViewportWs(bounds, 12), { wrapper: wrapper(store) })
    const ws = MockWebSocket.instances[0]!
    act(() => ws.simulateOpen())
    act(() => ws.simulateMessage({ type: 'INITIAL_BATCH', events: [wsEvent] }))
    act(() => ws.simulateMessage({
      type: 'DIFF_PATCH',
      added: [{ ...wsEvent, id: 'e2', title: 'New' }],
      removed: ['e1'],
      updated: [],
    }))
    const items = store.getState().viewportEvents.items
    expect(items).toHaveLength(1)
    expect(items[0]!.id).toBe('e2')
  })

  it('toSafetyEvent maps is_active from state', () => {
    const store = makeStore()
    renderHook(() => useViewportWs(bounds, 12), { wrapper: wrapper(store) })
    const ws = MockWebSocket.instances[0]!
    act(() => ws.simulateOpen())
    act(() => ws.simulateMessage({
      type: 'INITIAL_BATCH',
      events: [{ ...wsEvent, state: 'RESOLVED' }],
    }))
    expect(store.getState().viewportEvents.items[0]!.is_active).toBe(false)
  })

  it('reconnects with backoff on unexpected close', () => {
    const store = makeStore()
    renderHook(() => useViewportWs(bounds, 12), { wrapper: wrapper(store) })
    const ws = MockWebSocket.instances[0]!
    act(() => ws.simulateOpen())
    act(() => ws.simulateClose(1006))
    expect(MockWebSocket.instances).toHaveLength(1)
    act(() => vi.advanceTimersByTime(2000))
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('does not reconnect on clean close (code 1000)', () => {
    const store = makeStore()
    renderHook(() => useViewportWs(bounds, 12), { wrapper: wrapper(store) })
    const ws = MockWebSocket.instances[0]!
    act(() => ws.simulateOpen())
    act(() => ws.simulateClose(1000))
    act(() => vi.advanceTimersByTime(5000))
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('closes WS cleanly on unmount', () => {
    const store = makeStore()
    const { unmount } = renderHook(() => useViewportWs(bounds, 12), { wrapper: wrapper(store) })
    const ws = MockWebSocket.instances[0]!
    act(() => ws.simulateOpen())
    unmount()
    expect(ws.readyState).toBe(3)
  })
})
