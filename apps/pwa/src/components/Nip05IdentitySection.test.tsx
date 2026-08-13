import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { getIdentity, verifyIdentity, removeIdentity } = vi.hoisted(() => ({
  getIdentity: vi.fn(),
  verifyIdentity: vi.fn(),
  removeIdentity: vi.fn(),
}))

vi.mock('../services/nip05Service', () => ({
  getNip05Identity: getIdentity,
  verifyNip05Identity: verifyIdentity,
  removeNip05Identity: removeIdentity,
}))

import { Nip05IdentitySection } from './Nip05IdentitySection'

const status = {
  identifier: 'alice@example.com',
  verified: true,
  verified_at: '2026-08-12T00:00:00Z',
  valid_until: '2026-08-13T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  getIdentity.mockResolvedValue(null)
  verifyIdentity.mockResolvedValue(status)
  removeIdentity.mockResolvedValue(undefined)
})

describe('Nip05IdentitySection', () => {
  test('verifies an identifier for the active signer', async () => {
    render(<Nip05IdentitySection pubkey="local-key" />)
    expect(screen.getByText(/active public key/i)).toBeInTheDocument()
    const input = screen.getByLabelText(/optional nip-05 identity/i)
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.change(input, { target: { value: 'alice@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(verifyIdentity).toHaveBeenCalledWith('alice@example.com'))
    expect(await screen.findByText(/identity verified for the active key/i)).toBeInTheDocument()
  })

  test('rejects malformed identifiers before a request', async () => {
    render(<Nip05IdentitySection pubkey="local-key" />)
    const input = screen.getByLabelText(/optional nip-05 identity/i)
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.change(input, { target: { value: 'not-an-id' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(await screen.findByText(/valid name@domain/i)).toBeInTheDocument()
    expect(verifyIdentity).not.toHaveBeenCalled()
  })

  test('loads and removes an existing identity without changing the key', async () => {
    getIdentity.mockResolvedValue(status)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Nip05IdentitySection pubkey="local-key" />)
    expect(await screen.findByDisplayValue('alice@example.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(removeIdentity).toHaveBeenCalledOnce())
    expect(await screen.findByText(/signing key is unchanged/i)).toBeInTheDocument()
  })

  test('ignores an old-key response after the local key changes', async () => {
    let resolveOld!: (value: typeof status) => void
    getIdentity
      .mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValueOnce(null)
    const { rerender } = render(<Nip05IdentitySection pubkey="old-key" />)
    rerender(<Nip05IdentitySection pubkey="new-key" />)
    await waitFor(() => expect(getIdentity).toHaveBeenCalledTimes(2))
    resolveOld(status)
    await waitFor(() => expect(screen.getByLabelText(/optional nip-05 identity/i)).toHaveValue(''))
  })
})
