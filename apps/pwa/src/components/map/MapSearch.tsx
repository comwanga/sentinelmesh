import { useEffect, useId, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { searchAddress, type GeocodeSuggestion } from '../../services/mapApiService'

interface Props {
  initialQuery?: string
  proximity?: { lat: number; lng: number }
  onSelect: (result: GeocodeSuggestion) => void
  onClear?: () => void
}

export function MapSearch({ initialQuery = '', proximity, onSelect, onClear }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<GeocodeSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(-1)
  const [focused, setFocused] = useState(Boolean(initialQuery.trim()))
  const listId = useId()
  const sequence = useRef(0)
  const trimmed = query.trim()
  const open = focused && trimmed.length >= 2

  useEffect(() => {
    const request = ++sequence.current
    setActive(-1)
    setFailed(false)
    if (trimmed.length < 2) {
      setLoading(false)
      setResults([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const next = await searchAddress(trimmed, proximity, controller.signal)
        if (request !== sequence.current) return
        setResults(next)
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
        if (request === sequence.current) {
          setResults([])
          setFailed(true)
        }
      } finally {
        if (request === sequence.current && !controller.signal.aborted) setLoading(false)
      }
    }, 275)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed, proximity?.lat, proximity?.lng])

  function choose(index: number) {
    const result = results[index]
    if (!result) return
    setQuery(result.label)
    setFocused(false)
    setActive(-1)
    onSelect(result)
  }

  const status = loading ? 'Searching places' : failed ? 'Search unavailable. Try again.' : results.length ? `${results.length} results available` : trimmed.length >= 2 ? 'No results found' : 'Enter at least 2 characters'

  return <div className="map-search">
    <div className="map-search-control">
      <Search aria-hidden="true" />
      <input
        aria-label="Search addresses, roads, places, and points of interest"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        value={query}
        placeholder="Find a place on the map"
        onFocus={() => setFocused(true)}
        onChange={event => { setQuery(event.target.value); setFocused(true) }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive(current => Math.min(current + 1, results.length - 1)) }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive(current => Math.max(current - 1, 0)) }
          if (event.key === 'Enter' && active >= 0) { event.preventDefault(); choose(active) }
          if (event.key === 'Escape') { event.preventDefault(); setFocused(false); setActive(-1) }
        }}
      />
      {query && <button type="button" aria-label="Clear map search" onClick={() => { setQuery(''); setResults([]); onClear?.() }}><X /></button>}
    </div>
    {open && <div id={listId} role="listbox" aria-label="Map search results" className="map-search-results">
      {results.map((result, index) => <button
        type="button"
        role="option"
        id={`${listId}-${index}`}
        aria-selected={active === index}
        key={result.id}
        onMouseDown={event => event.preventDefault()}
        onClick={() => choose(index)}
      ><strong>{result.label}</strong><span>{result.kind}</span></button>)}
      {loading && <div>Searching places...</div>}
      {!loading && !results.length && <div className={failed ? 'error' : ''}>{failed ? 'Search unavailable. Try again.' : 'No results found'}</div>}
    </div>}
    <span className="sr-only" role="status" aria-live="polite">{status}</span>
  </div>
}
