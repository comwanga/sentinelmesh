import { useState, useEffect } from 'react'

export type Layout = 'mobile' | 'desktop'

export function useBreakpoint(): { layout: Layout } {
  const query = '(max-width: 767px)'
  const [layout, setLayout] = useState<Layout>(
    () => (window.matchMedia(query).matches ? 'mobile' : 'desktop')
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => {
      setLayout(e.matches ? 'mobile' : 'desktop')
    }
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return { layout }
}
