import { render, screen } from '@testing-library/react'
import { VerificationBadges } from './VerificationBadges'

describe('VerificationBadges', () => {
  it('renders nothing when both IDs are null', () => {
    const { container } = render(
      <VerificationBadges nostrEventId={null} bitcoinTxid={null} />
    )
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })

  it('renders Nostr badge with njump.me link when nostrEventId is set', () => {
    render(<VerificationBadges nostrEventId="abc123" bitcoinTxid={null} />)
    const link = screen.getByText('⚡ Nostr')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', 'https://njump.me/abc123')
    expect(link.closest('a')).toHaveAttribute('target', '_blank')
  })

  it('hides experimental Bitcoin presentation by default', () => {
    const { container } = render(<VerificationBadges nostrEventId={null} bitcoinTxid="txid456" />)
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })

  it('still renders a factual Nostr badge when a Bitcoin ID is also present', () => {
    render(<VerificationBadges nostrEventId="abc" bitcoinTxid="def" />)
    expect(screen.getByText('⚡ Nostr')).toBeInTheDocument()
    expect(screen.queryByText('₿ Anchored')).not.toBeInTheDocument()
  })
})
