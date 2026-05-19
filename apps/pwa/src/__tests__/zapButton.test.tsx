import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ZapButton } from '../components/ZapButton'

// Mock signAuthEvent so tests don't need a real key
vi.mock('../services/nostrService', () => ({
  signAuthEvent: vi.fn().mockResolvedValue({
    id: 'aabbcc',
    pubkey: 'deadbeef',
    created_at: 1000,
    kind: 27235,
    tags: [],
    content: '',
    sig: 'sigaabbcc',
  }),
}))

describe('ZapButton', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('renders with default 21 sats label', () => {
    render(<ZapButton reportId="report-1" />)
    expect(screen.getByText('⚡ 21 sats')).toBeTruthy()
  })

  test('renders with custom amountSats', () => {
    render(<ZapButton reportId="report-1" amountSats={100} />)
    expect(screen.getByText('⚡ 100 sats')).toBeTruthy()
  })

  test('sends X-Nostr-Auth header on click', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ payment_request: 'lnbc210n...' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ZapButton reportId="report-1" />)
    fireEvent.click(screen.getByText('⚡ 21 sats'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce()
    })

    const [_url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = opts.headers as Record<string, string>
    expect(headers['X-Nostr-Auth']).toBeDefined()
    expect(headers['X-Nostr-Auth']).toContain('"kind":27235')
  })

  test('shows invoice textarea on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ payment_request: 'lnbc210ntest' }),
    }))

    render(<ZapButton reportId="report-1" />)
    fireEvent.click(screen.getByText('⚡ 21 sats'))

    await waitFor(() => {
      expect(screen.getByDisplayValue('lnbc210ntest')).toBeTruthy()
    })
  })

  test('shows error message on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'missing X-Nostr-Auth header' }),
    }))

    render(<ZapButton reportId="report-1" />)
    fireEvent.click(screen.getByText('⚡ 21 sats'))

    await waitFor(() => {
      expect(screen.getByText(/missing X-Nostr-Auth header/)).toBeTruthy()
    })
  })

  test('shows error message on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    render(<ZapButton reportId="report-1" />)
    fireEvent.click(screen.getByText('⚡ 21 sats'))

    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeTruthy()
    })
  })
})
