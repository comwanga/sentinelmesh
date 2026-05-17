import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useInitialViewport } from './useInitialViewport'

const KEY = 'sentinel_last_viewport'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('useInitialViewport', () => {
  it('returns world center when no saved viewport', () => {
    const { result } = renderHook(() => useInitialViewport())
    expect(result.current.longitude).toBe(0)
    expect(result.current.latitude).toBe(20)
    expect(result.current.zoom).toBe(2)
  })

  it('returns saved viewport from localStorage', () => {
    localStorage.setItem(KEY, JSON.stringify({ longitude: 36.82, latitude: -1.29, zoom: 12 }))
    const { result } = renderHook(() => useInitialViewport())
    expect(result.current.longitude).toBe(36.82)
    expect(result.current.latitude).toBe(-1.29)
    expect(result.current.zoom).toBe(12)
  })

  it('falls back to world center when localStorage value is corrupted', () => {
    localStorage.setItem(KEY, 'not-valid-json{{')
    const { result } = renderHook(() => useInitialViewport())
    expect(result.current.longitude).toBe(0)
    expect(result.current.latitude).toBe(20)
  })
})
