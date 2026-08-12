import { render, screen } from '@testing-library/react'
import { VerificationBadges } from './VerificationBadges'

describe('VerificationBadges', () => {
  it('renders nothing when no Nostr event ID is present', () => {
    const { container } = render(<VerificationBadges nostrEventId={null} />)
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })

  it('renders Nostr badge with njump.me link when nostrEventId is set', () => {
    render(<VerificationBadges nostrEventId="abc123" />)
    const link = screen.getByText('⚡ Nostr')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', 'https://njump.me/abc123')
    expect(link.closest('a')).toHaveAttribute('target', '_blank')
  })
})
