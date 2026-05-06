import { renderHook, act } from '@testing-library/react'
import { useBreakpoint } from './useBreakpoint'

function mockMatchMedia(matches: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = []
  const mql = {
    matches,
    addEventListener: vi.fn((_: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners.push(fn)
    }),
    removeEventListener: vi.fn(),
  }
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn(() => mql) })
  return { mql, listeners }
}

describe('useBreakpoint', () => {
  it('returns desktop when viewport is wide', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current.layout).toBe('desktop')
  })

  it('returns mobile when viewport is narrow', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current.layout).toBe('mobile')
  })

  it('updates layout when media query changes', () => {
    const { listeners } = mockMatchMedia(false)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current.layout).toBe('desktop')
    act(() => listeners[0]!({ matches: true } as MediaQueryListEvent))
    expect(result.current.layout).toBe('mobile')
  })

  it('removes listener on unmount', () => {
    const { mql } = mockMatchMedia(false)
    const { unmount } = renderHook(() => useBreakpoint())
    unmount()
    expect(mql.removeEventListener).toHaveBeenCalledOnce()
  })
})
