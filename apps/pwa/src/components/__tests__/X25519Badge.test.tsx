import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { X25519Badge } from '../X25519Badge'

describe('X25519Badge', () => {
  it('renders the X25519 Active label', () => {
    render(<X25519Badge />)
    expect(screen.getByText(/X25519 Active/i)).toBeInTheDocument()
  })

  it('renders with absolute positioning', () => {
    const { container } = render(<X25519Badge />)
    const el = container.firstChild as HTMLElement
    expect(el.style.position).toBe('absolute')
  })
})
