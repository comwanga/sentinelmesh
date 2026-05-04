import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InviteModal } from '../InviteModal'

describe('InviteModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <InviteModal isOpen={false} inviteString="" onClose={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('displays invite string in a readonly input', () => {
    render(<InviteModal isOpen={true} inviteString="nostr:abc123" onClose={vi.fn()} />)
    const input = screen.getByDisplayValue('nostr:abc123') as HTMLInputElement
    expect(input.readOnly).toBe(true)
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<InviteModal isOpen={true} inviteString="nostr:abc" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
