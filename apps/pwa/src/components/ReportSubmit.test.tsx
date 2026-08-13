import { vi, describe, test, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import reportsReducer from '../store/reportSlice'

// Mock services before import
vi.mock('../services/nostrService', () => ({
  signBoundEvent: vi.fn().mockResolvedValue({
    id: 'ev1', pubkey: 'pk1', created_at: 1000, kind: 30078,
    tags: [], content: '{}', sig: 'sig1',
  }),
  reportBindingContent: vi.fn().mockReturnValue('r1|FLOODING|0.000000|0.000000|'),
}))
vi.mock('../services/photoService', () => ({
  compressAndStrip: vi.fn().mockResolvedValue(new Blob(['img'])),
  blurFaces: vi.fn().mockResolvedValue(document.createElement('canvas')),
  uploadToIPFS: vi.fn().mockResolvedValue(null),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)
vi.stubGlobal('navigator', {
  geolocation: {
    getCurrentPosition: (cb: PositionCallback) =>
      cb({ coords: { latitude: -1.29, longitude: 36.82 } } as GeolocationPosition),
  },
})

import { ReportSubmit } from './ReportSubmit'

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'r1', report_type: 'FLOODING', status: 'PENDING' }) })
})

function renderSubmit(onClose: () => void) {
  const store = configureStore({ reducer: { reports: reportsReducer } })
  return render(<Provider store={store}><ReportSubmit onClose={onClose} /></Provider>)
}

describe('ReportSubmit', () => {
  test('renders report type selector and submit button', () => {
    const onClose = vi.fn()
    renderSubmit(onClose)
    expect(screen.getByRole('combobox')).toBeTruthy()
    expect(screen.getByRole('button', { name: /submit/i })).toBeTruthy()
  })

  test('POSTs to /api/reports on submit', async () => {
    const onClose = vi.fn()
    renderSubmit(onClose)
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce())
    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toContain('/api/reports')
  })

  test('calls onClose after successful submit', async () => {
    const onClose = vi.fn()
    renderSubmit(onClose)
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  test('shows error message on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    const onClose = vi.fn()
    renderSubmit(onClose)
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    await waitFor(() => screen.getByText(/failed/i))
  })
})
