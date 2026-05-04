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

  it('renders Bitcoin badge with testnet mempool.space link by default', () => {
    render(<VerificationBadges nostrEventId={null} bitcoinTxid="txid456" />)
    const link = screen.getByText('₿ Anchored')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute(
      'href',
      'https://mempool.space/testnet/tx/txid456'
    )
  })

  it('renders both badges when both IDs are set', () => {
    render(<VerificationBadges nostrEventId="abc" bitcoinTxid="def" />)
    expect(screen.getByText('⚡ Nostr')).toBeInTheDocument()
    expect(screen.getByText('₿ Anchored')).toBeInTheDocument()
  })
})
