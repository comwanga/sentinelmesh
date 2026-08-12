import { act, renderHook } from '@testing-library/react'
import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import eventsReducer from '../../store/eventsSlice'
import reportsReducer from '../../store/reportSlice'

const { fetchInitialEvents, fetchInitialReports, useWsConnection } = vi.hoisted(() => ({
  fetchInitialEvents: vi.fn(),
  fetchInitialReports: vi.fn(),
  useWsConnection: vi.fn(),
}))

vi.mock('../../services/safetyDataApi', () => ({ fetchInitialEvents, fetchInitialReports }))
vi.mock('../../services/websocket', () => ({ useWsConnection }))

import { useSafetyDataSync } from '../useSafetyDataSync'

function makeStore() {
  return configureStore({ reducer: { events: eventsReducer, reports: reportsReducer } })
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
}

beforeEach(() => vi.clearAllMocks())

describe('useSafetyDataSync', () => {
  it('connects realtime and hydrates both core resources', async () => {
    const store = makeStore()
    fetchInitialEvents.mockResolvedValue([{ id: 'event-1' }])
    fetchInitialReports.mockResolvedValue([{ id: 'report-1' }])

    renderHook(() => useSafetyDataSync(), { wrapper: wrapper(store) })
    await act(async () => Promise.resolve())

    expect(useWsConnection).toHaveBeenCalledOnce()
    expect(store.getState().events.items[0]!.id).toBe('event-1')
    expect(store.getState().reports.items[0]!.id).toBe('report-1')
  })

  it('keeps report synchronization available when event loading fails', async () => {
    const store = makeStore()
    fetchInitialEvents.mockRejectedValue(new Error('events unavailable'))
    fetchInitialReports.mockResolvedValue([{ id: 'report-1' }])

    renderHook(() => useSafetyDataSync(), { wrapper: wrapper(store) })
    await act(async () => Promise.resolve())

    expect(store.getState().events.error).toContain('events unavailable')
    expect(store.getState().reports.items[0]!.id).toBe('report-1')
  })
})
