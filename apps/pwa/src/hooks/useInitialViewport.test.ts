import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MAX_VIEWPORT_ZOOM, persistViewport, useInitialViewport } from './useInitialViewport'

const KEY = 'sentinel_last_viewport'
const WORLD_CENTER = { longitude: 0, latitude: 20, zoom: 2 }

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useInitialViewport', () => {
  it('returns world center when no viewport is saved', () => {
    const { result } = renderHook(() => useInitialViewport())
    expect(result.current).toEqual(WORLD_CENTER)
  })

  it('returns a valid saved viewport', () => {
    localStorage.setItem(KEY, JSON.stringify({ longitude: 36.82, latitude: -1.29, zoom: 12 }))
    const { result } = renderHook(() => useInitialViewport())
    expect(result.current).toEqual({ longitude: 36.82, latitude: -1.29, zoom: 12 })
  })

  it.each([
    ['invalid JSON', 'not-valid-json{{'],
    ['null', 'null'],
    ['array', '[1,2,3]'],
    ['missing field', '{"longitude":1,"latitude":2}'],
    ['non-number', '{"longitude":"1","latitude":2,"zoom":3}'],
    ['non-finite', '{"longitude":1e400,"latitude":2,"zoom":3}'],
    ['longitude below range', '{"longitude":-181,"latitude":2,"zoom":3}'],
    ['longitude above range', '{"longitude":181,"latitude":2,"zoom":3}'],
    ['latitude below range', '{"longitude":1,"latitude":-91,"zoom":3}'],
    ['latitude above range', '{"longitude":1,"latitude":91,"zoom":3}'],
    ['zoom below range', '{"longitude":1,"latitude":2,"zoom":-1}'],
    ['zoom above range', `{"longitude":1,"latitude":2,"zoom":${MAX_VIEWPORT_ZOOM + 1}}`],
  ])('falls back for %s', (_label, saved) => {
    localStorage.setItem(KEY, saved)
    expect(renderHook(() => useInitialViewport()).result.current).toEqual(WORLD_CENTER)
  })

  it('catches localStorage read failures', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(renderHook(() => useInitialViewport()).result.current).toEqual(WORLD_CENTER)
  })
})

describe('persistViewport', () => {
  it('stores valid viewports', () => {
    persistViewport({ longitude: -180, latitude: 90, zoom: MAX_VIEWPORT_ZOOM })
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ longitude: -180, latitude: 90, zoom: 24 })
  })

  it('stores only coordinates required to restore the camera', () => {
    persistViewport({
      longitude: 36.82,
      latitude: -1.29,
      zoom: 12,
      bearing: 40,
      pitch: 30,
    } as Parameters<typeof persistViewport>[0] & { bearing: number; pitch: number })
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      longitude: 36.82,
      latitude: -1.29,
      zoom: 12,
    })
  })

  it('does not store invalid viewports', () => {
    persistViewport({ longitude: 181, latitude: 0, zoom: 3 })
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('catches localStorage write failures', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => persistViewport({ longitude: 1, latitude: 2, zoom: 3 })).not.toThrow()
  })
})
