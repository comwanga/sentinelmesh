import { configureStore } from '@reduxjs/toolkit'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import eventsReducer from '../store/eventsSlice'
import uiReducer, { setHomeLocation } from '../store/uiSlice'
import { HomeRoutePanel } from './HomeRoutePanel'

const mocks = vi.hoisted(() => ({
  geocode: vi.fn(),
  saveHome: vi.fn(),
  clearHome: vi.fn(),
  fetchRoute: vi.fn(),
}))
vi.mock('../services/geocodingService', () => ({ geocodeAddress: mocks.geocode }))
vi.mock('../services/homeLocationStore', () => ({ saveHomeLocation: mocks.saveHome, clearHomeLocation: mocks.clearHome }))
vi.mock('../services/routingService', () => ({ fetchRouteToHome: mocks.fetchRoute }))

function setup(saved = false, searchProximity?: { lat: number; lng: number }) {
  const store = configureStore({ reducer: { events: eventsReducer, ui: uiReducer } })
  if (saved) store.dispatch(setHomeLocation({ lat: 1, lng: 2, label: 'Device home' }))
  const location = { lat: 3, lng: 4, accuracy: 5 }
  render(<Provider store={store}><HomeRoutePanel location={location} locationStatus="following" searchProximity={searchProximity} onClose={vi.fn()} /></Provider>)
  return store
}

describe('HomeRoutePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.saveHome.mockResolvedValue(undefined)
    mocks.clearHome.mockResolvedValue(undefined)
    mocks.fetchRoute.mockResolvedValue([])
  })

  it('requires confirmation before encrypted device-only saving', async () => {
    mocks.geocode.mockResolvedValue([{ id: 'h1', label: 'Exact home', kind: 'address', lat: 1, lng: 2 }])
    setup()
    fireEvent.change(screen.getByLabelText('Set home'), { target: { value: 'Exact' } })
    fireEvent.click(await screen.findByRole('option', { name: 'Exact home' }, { timeout: 1500 }))
    expect(mocks.saveHome).not.toHaveBeenCalled()
    expect(screen.getByText(/stored only on this device/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Confirm and save/i }))
    await waitFor(() => expect(mocks.saveHome).toHaveBeenCalledWith({ lat: 1, lng: 2, label: 'Exact home' }))
  })

  it('uses the shared GPS fix and selected supported mode for route previews', async () => {
    mocks.fetchRoute.mockResolvedValue([{ id: 'provider-1', coordinates: [[4, 3], [2, 1]], distanceKm: 2, durationMin: 8, warnings: [], label: 'Best route', mode: 'cycling', alertIntersections: 0 }])
    setup(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cycling' }))
    fireEvent.click(screen.getByRole('button', { name: 'Request route preview' }))
    await waitFor(() => expect(mocks.fetchRoute).toHaveBeenCalledWith({ lat: 3, lng: 4, accuracy: 5 }, { lat: 1, lng: 2, label: 'Device home' }, [], 'cycling'))
    expect(screen.getByText('2 km, 8 min')).toBeInTheDocument()
  })

  it('shows storage denial', async () => {
    mocks.geocode.mockResolvedValue([{ id: 'h1', label: 'Exact home', kind: 'address', lat: 1, lng: 2 }])
    mocks.saveHome.mockRejectedValue(new Error('denied'))
    setup()
    fireEvent.change(screen.getByLabelText('Set home'), { target: { value: 'Exact' } })
    fireEvent.click(await screen.findByRole('option', { name: 'Exact home' }, { timeout: 1500 }))
    fireEvent.click(screen.getByRole('button', { name: /Confirm and save/i }))
    expect(await screen.findByText(/could not be saved/i)).toBeInTheDocument()
  })

  it('shows route request errors', async () => {
    mocks.fetchRoute.mockRejectedValue(new Error('offline'))
    setup(true)
    fireEvent.click(screen.getByRole('button', { name: 'Request route preview' }))
    expect(await screen.findByText(/provider could not be reached/i)).toBeInTheDocument()
  })

  it('distinguishes a valid empty route response from provider failure', async () => {
    setup(true)
    fireEvent.click(screen.getByRole('button', { name: 'Request route preview' }))
    expect(await screen.findByText(/No route preview is available/i)).toBeInTheDocument()
  })

  it('uses only coarse map proximity for autocomplete, never exact GPS', async () => {
    mocks.geocode.mockResolvedValue([])
    setup(false, { lat: -1.29, lng: 36.82 })
    fireEvent.change(screen.getByLabelText('Set home'), { target: { value: 'Park' } })
    await waitFor(() => expect(mocks.geocode).toHaveBeenCalled())
    expect(mocks.geocode).toHaveBeenCalledWith('Park', { lat: -1.29, lng: 36.82 }, expect.any(AbortSignal))
    expect(mocks.geocode).not.toHaveBeenCalledWith('Park', { lat: 3, lng: 4, accuracy: 5 }, expect.anything())
  })

  it('omits autocomplete proximity before a map viewport exists', async () => {
    mocks.geocode.mockResolvedValue([])
    setup()
    fireEvent.change(screen.getByLabelText('Set home'), { target: { value: 'Park' } })
    await waitFor(() => expect(mocks.geocode).toHaveBeenCalled())
    expect(mocks.geocode).toHaveBeenCalledWith('Park', undefined, expect.any(AbortSignal))
  })

  it('aborts superseded autocomplete without showing a failure or stale results', async () => {
    let rejectFirst: (reason: unknown) => void = () => undefined
    mocks.geocode
      .mockImplementationOnce((_query: string, _proximity: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
        rejectFirst = reject
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }))
      .mockResolvedValueOnce([{ id: 'new', label: 'New result', kind: 'place', lat: 1, lng: 2 }])
    setup()
    fireEvent.change(screen.getByLabelText('Set home'), { target: { value: 'Old' } })
    await waitFor(() => expect(mocks.geocode).toHaveBeenCalledTimes(1))
    const firstSignal = mocks.geocode.mock.calls[0][2] as AbortSignal
    fireEvent.change(screen.getByLabelText('Set home'), { target: { value: 'New' } })
    expect(firstSignal.aborted).toBe(true)
    rejectFirst(new DOMException('Aborted', 'AbortError'))
    expect(await screen.findByRole('option', { name: 'New result' }, { timeout: 1500 })).toBeInTheDocument()
    expect(screen.queryByText(/search is unavailable/i)).not.toBeInTheDocument()
  })
})
