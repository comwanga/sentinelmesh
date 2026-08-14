import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchAddress, type GeocodeSuggestion } from '../../services/mapApiService'
import { MapSearch } from './MapSearch'

vi.mock('../../services/mapApiService', () => ({ searchAddress: vi.fn() }))

const result: GeocodeSuggestion = { id: 'p1', label: 'Central Park', kind: 'poi', lat: 1.23, lng: 4.56 }

describe('MapSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(searchAddress).mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('debounces, uses map proximity, and exposes combobox ARIA', async () => {
    vi.mocked(searchAddress).mockResolvedValue([result])
    render(<MapSearch proximity={{ lat: 1.2, lng: 4.6 }} onSelect={vi.fn()} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: ' c' } })
    act(() => vi.advanceTimersByTime(300))
    expect(searchAddress).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: ' Central ' } })
    expect(input).toHaveAttribute('aria-expanded', 'true')
    await act(async () => vi.advanceTimersByTime(275))
    expect(searchAddress).toHaveBeenCalledWith('Central', { lat: 1.2, lng: 4.6 }, expect.any(AbortSignal))
    expect(screen.getByRole('option', { name: /Central Park/i })).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
  })

  it('aborts the previous request and suppresses its stale response', async () => {
    const pending: Array<(value: GeocodeSuggestion[]) => void> = []
    const signals: AbortSignal[] = []
    vi.mocked(searchAddress).mockImplementation((_query, _proximity, signal) => {
      signals.push(signal!)
      return new Promise(resolve => pending.push(resolve))
    })
    render(<MapSearch onSelect={vi.fn()} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'park' } })
    await act(async () => vi.advanceTimersByTime(275))
    fireEvent.change(input, { target: { value: 'market' } })
    expect(signals[0].aborted).toBe(true)
    await act(async () => vi.advanceTimersByTime(275))
    await act(async () => pending[1]([{ ...result, id: 'new', label: 'Market' }]))
    await act(async () => pending[0]([{ ...result, id: 'old', label: 'Old Park' }]))
    expect(screen.getByText('Market')).toBeInTheDocument()
    expect(screen.queryByText('Old Park')).not.toBeInTheDocument()
  })

  it('supports keyboard navigation, selection, and Escape', async () => {
    const onSelect = vi.fn()
    vi.mocked(searchAddress).mockResolvedValue([result])
    render(<MapSearch initialQuery="central" onSelect={onSelect} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    await act(async () => vi.advanceTimersByTime(275))
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option').id)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(result)
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('announces failures without treating an abort as an error', async () => {
    vi.mocked(searchAddress).mockRejectedValue(new Error('offline'))
    render(<MapSearch initialQuery="central" onSelect={vi.fn()} />)
    fireEvent.focus(screen.getByRole('combobox'))
    await act(async () => vi.advanceTimersByTime(275))
    expect(screen.getByRole('status')).toHaveTextContent('Search unavailable')
  })
})
