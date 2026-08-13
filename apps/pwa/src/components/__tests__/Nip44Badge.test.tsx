import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Nip44Badge } from '../Nip44Badge'

describe('Nip44Badge', () => {
  it('renders the NIP-44 key distribution label', () => {
    render(<Nip44Badge />)
    expect(screen.getByText(/NIP-44 Key Distribution/i)).toBeInTheDocument()
  })

  it('renders with absolute positioning', () => {
    const { container } = render(<Nip44Badge />)
    const el = container.firstChild as HTMLElement
    expect(el.style.position).toBe('absolute')
  })
})
