import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemberChip } from '../MemberChip'

describe('MemberChip', () => {
  it('renders truncated pubkey', () => {
    render(<MemberChip pubkey="npub1abc123def456" status="ONLINE" />)
    expect(screen.getByText(/npub1abc…/)).toBeInTheDocument()
  })

  it('applies online ring color for ONLINE status', () => {
    const { container } = render(<MemberChip pubkey="npub1abc123" status="ONLINE" />)
    const ring = container.querySelector('[data-status="ONLINE"]')
    expect(ring).toBeTruthy()
  })

  it('applies ghost ring color for GHOST status', () => {
    const { container } = render(<MemberChip pubkey="npub1abc123" status="GHOST" />)
    const ring = container.querySelector('[data-status="GHOST"]')
    expect(ring).toBeTruthy()
  })

  it('applies offline ring color for OFFLINE status', () => {
    const { container } = render(<MemberChip pubkey="npub1abc123" status="OFFLINE" />)
    const ring = container.querySelector('[data-status="OFFLINE"]')
    expect(ring).toBeTruthy()
  })
})
