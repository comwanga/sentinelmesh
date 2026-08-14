import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from './SettingsPage'

const localIdentity = { publicKey: 'a'.repeat(64), secretKey: new Uint8Array(32) }

vi.mock('../components/AlertPerimeter', () => ({ AlertPerimeter: () => <div data-testid="alert-perimeter" /> }))
vi.mock('../components/Nip05IdentitySection', () => ({ Nip05IdentitySection: () => <div>NIP-05 controls</div> }))
vi.mock('../hooks/useActiveIdentity', () => ({
  useActiveIdentity: () => ({ mode: 'local', status: 'ready', pubkey: 'a'.repeat(64), error: null, approvalUrl: null }),
}))
vi.mock('../services/nostrService', () => ({
  loadIdentity: vi.fn(async () => localIdentity),
  generateNewIdentity: vi.fn(async () => localIdentity),
  toNpub: vi.fn(() => 'npub1activeidentity'),
  toNsec: vi.fn(() => 'nsec1localsecret'),
  importFromNsec: vi.fn(async () => localIdentity),
}))
vi.mock('../services/backupService', () => ({
  exportBackup: vi.fn(), decryptBackup: vi.fn(), applyRestore: vi.fn(), currentVaultId: vi.fn(),
}))
vi.mock('../services/identityStore', () => ({
  vaultFingerprint: vi.fn(async () => 'fingerprint'), loadVaultMeta: vi.fn(async () => null),
}))
vi.mock('../services/signerService', () => ({
  connectBunker: vi.fn(), disconnectBunker: vi.fn(), reconnectBunker: vi.fn(), refreshLocalIdentity: vi.fn(),
}))

describe('SettingsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps advanced identity forms out of the default page', async () => {
    render(<SettingsPage />)
    expect(await screen.findByText('Local identity ready')).toBeInTheDocument()
    expect(screen.getByTestId('alert-perimeter')).toBeInTheDocument()
    expect(await screen.findByText('Create your first backup')).toBeInTheDocument()
    expect(screen.queryByLabelText('Bunker connection URI')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Backup passphrase')).not.toBeInTheDocument()
    expect(screen.queryByText(/vouch for a key/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/open protocols/i)).not.toBeInTheDocument()
  })

  it('reveals signing and recovery controls only when requested', async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)
    await user.click(await screen.findByRole('button', { name: 'Signing options' }))
    expect(screen.getByRole('dialog', { name: 'Manage identity' })).toBeInTheDocument()
    expect(screen.getByLabelText('Bunker connection URI')).toBeInTheDocument()
    expect(screen.getByText('NIP-05 controls')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /recovery/i }))
    expect(screen.getByPlaceholderText('Backup passphrase')).toBeInTheDocument()
    expect(screen.getByText('Restore a backup')).toBeInTheDocument()
    expect(screen.getByText('Replace this identity')).toBeInTheDocument()
  })
})
