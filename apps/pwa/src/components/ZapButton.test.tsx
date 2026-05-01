import { vi, describe, test, expect, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ZapButton } from './ZapButton'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

beforeEach(() => { mockFetch.mockReset() })

describe('ZapButton', () => {
  test('renders tip button', () => {
    render(<ZapButton reportId="test-report-id" />)
    expect(screen.getByRole('button')).toBeTruthy()
  })

  test('POSTs to /api/zaps/request with correct body on click', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ payment_request: 'lnbc21n1test', payment_hash: 'abc123' }),
    })
    render(<ZapButton reportId="report-abc" />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledOnce())

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/zaps/request')
    const body = JSON.parse(init.body as string)
    expect(body.report_id).toBe('report-abc')
    expect(body.amount_sats).toBe(21)
  })

  test('displays invoice text after successful request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ payment_request: 'lnbc21n1payinvoice', payment_hash: 'hash1' }),
    })
    render(<ZapButton reportId="report-xyz" />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => screen.getByText(/lnbc21n1payinvoice/))
  })

  test('shows error message when request fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
    render(<ZapButton reportId="missing-report" />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => screen.getByText(/failed/i))
  })
})
