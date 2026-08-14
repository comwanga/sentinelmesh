import { useState, useCallback, useEffect } from 'react'
import { BadgeCheck, Copy, HardDriveDownload, KeyRound, RadioTower, ShieldCheck, X } from 'lucide-react'
import { loadIdentity, generateNewIdentity, toNpub, toNsec, importFromNsec, type NostrKeypair } from '../services/nostrService'
import { exportBackup, decryptBackup, applyRestore, currentVaultId, type RestoreResult } from '../services/backupService'
import { vaultFingerprint, loadVaultMeta } from '../services/identityStore'
import type { VaultPayload } from '../services/identityStore'
import { Nip05IdentitySection } from '../components/Nip05IdentitySection'
import { useActiveIdentity } from '../hooks/useActiveIdentity'
import { connectBunker, disconnectBunker, reconnectBunker, refreshLocalIdentity } from '../services/signerService'
import { AlertPerimeter } from '../components/AlertPerimeter'

export function SettingsPage() {
  const [keypair, setKeypair] = useState<NostrKeypair | null>(null)
  const [copiedNpub, setCopiedNpub] = useState(false)
  const [showNsec, setShowNsec] = useState(false)
  const [copiedNsec, setCopiedNsec] = useState(false)
  const [nsecInput, setNsecInput] = useState('')
  const [importMsg, setImportMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [staleBadge, setStaleBadge] = useState<'none' | 'no-backup' | 'stale'>('none')
  const [exportPass, setExportPass] = useState('')
  const [exportPass2, setExportPass2] = useState('')
  const [shownVaultId, setShownVaultId] = useState<string | null>(null)
  const [backupMsg, setBackupMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [pendingPayload, setPendingPayload] = useState<{ payload: VaultPayload; vaultId: string } | null>(null)
  const [bunkerInput, setBunkerInput] = useState('')
  const [signerMsg, setSignerMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [manageTab, setManageTab] = useState<'signing' | 'recovery'>('signing')
  const activeIdentity = useActiveIdentity()

  // The persisted identity loads asynchronously from the encrypted vault.
  useEffect(() => { loadIdentity().then(setKeypair) }, [])

  const refreshStaleness = useCallback(async () => {
    const meta = await loadVaultMeta()
    if (!meta?.lastExportedFingerprint) { setStaleBadge('no-backup'); return }
    const current = await vaultFingerprint()
    setStaleBadge(current === meta.lastExportedFingerprint ? 'none' : 'stale')
  }, [])
  useEffect(() => { if (keypair) void refreshStaleness() }, [keypair, refreshStaleness])

  const npub = keypair ? toNpub(keypair.publicKey) : ''
  const nsec = keypair ? toNsec(keypair.secretKey) : ''
  const activeNpub = activeIdentity.pubkey ? toNpub(activeIdentity.pubkey) : npub

  const copyNpub = useCallback(() => {
    navigator.clipboard.writeText(activeNpub).then(() => {
      setCopiedNpub(true); setTimeout(() => setCopiedNpub(false), 2000)
    })
  }, [activeNpub])

  const copyNsec = useCallback(() => {
    navigator.clipboard.writeText(nsec).then(() => {
      setCopiedNsec(true); setTimeout(() => setCopiedNsec(false), 2000)
    })
  }, [nsec])

  const handleImport = useCallback(async () => {
    const trimmed = nsecInput.trim()
    if (!trimmed) return
    const imported = await importFromNsec(trimmed)
    if (imported) {
      setKeypair(imported)
      refreshLocalIdentity()
      setNsecInput('')
      setImportMsg({ text: 'Key imported and saved on this device.', ok: true })
    } else {
      setImportMsg({ text: 'Invalid nsec — make sure you paste a valid nsec1… key.', ok: false })
    }
    setTimeout(() => setImportMsg(null), 4000)
  }, [nsecInput])

  const handleGenerate = useCallback(async () => {
    if (!window.confirm('Generate a new Nostr key? Your current identity (and any circles tied to it) will be replaced. Make sure you have backed up your current key first.')) return
    const fresh = await generateNewIdentity()
    setKeypair(fresh)
    refreshLocalIdentity()
    setImportMsg({ text: 'New key generated and saved.', ok: true })
    setTimeout(() => setImportMsg(null), 3000)
  }, [])

  const handleExport = useCallback(async () => {
    if (exportPass.length < 12) { setBackupMsg({ text: 'Passphrase must be at least 12 characters.', ok: false }); return }
    if (exportPass !== exportPass2) { setBackupMsg({ text: 'Passphrases do not match.', ok: false }); return }
    try {
      const blob = await exportBackup(exportPass)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'sentinelmesh-backup.json'; a.click()
      URL.revokeObjectURL(url)
      setShownVaultId(await currentVaultId())
      setExportPass(''); setExportPass2('')
      setBackupMsg({ text: 'Backup downloaded. Note your Vault ID to verify it later.', ok: true })
      void refreshStaleness()
    } catch {
      setBackupMsg({ text: 'Export failed on this device.', ok: false })
    }
  }, [exportPass, exportPass2, refreshStaleness])

  const handleFilePicked = useCallback(async (file: File, passphrase: string) => {
    try {
      const text = await file.text()
      const decoded = await decryptBackup(text, passphrase)
      setPendingPayload(decoded)
      setBackupMsg(null)
    } catch (e) {
      setBackupMsg({ text: (e as Error).message, ok: false })
    }
  }, [])

  const handleConfirmRestore = useCallback(async () => {
    if (!pendingPayload) return
    if (!window.confirm('Restore this backup? It will REPLACE the identity currently on this device.')) return
    try {
      const result: RestoreResult = await applyRestore(pendingPayload.payload)
      setPendingPayload(null)
      setKeypair(await loadIdentity())
      refreshLocalIdentity()
      const failed = result.circlesFailed.length
      setBackupMsg({
        text: `Restored your identity and ${result.circlesRestored} circle(s)` + (failed ? `; ${failed} could not be restored.` : '.'),
        ok: failed === 0,
      })
      void refreshStaleness()
    } catch {
      setBackupMsg({ text: 'Restore failed — your current identity is unchanged.', ok: false })
    }
  }, [pendingPayload, refreshStaleness])

  const handleConnectBunker = useCallback(async () => {
    if (!bunkerInput.trim()) return
    setSignerMsg(null)
    try {
      await connectBunker(bunkerInput)
      setBunkerInput('')
      setSignerMsg({ text: 'Remote signer connected. Signing now uses the remote identity.', ok: true })
    } catch (error) {
      setSignerMsg({ text: (error as Error).message, ok: false })
    }
  }, [bunkerInput])

  const handleReconnectBunker = useCallback(async () => {
    setSignerMsg(null)
    try {
      await reconnectBunker()
      setSignerMsg({ text: 'Remote signer reconnected.', ok: true })
    } catch (error) {
      setSignerMsg({ text: (error as Error).message, ok: false })
    }
  }, [])

  const handleDisconnectBunker = useCallback(async () => {
    if (!window.confirm('Disconnect this remote signer and return to the local identity?')) return
    await disconnectBunker()
    setSignerMsg({ text: 'Remote signer removed. Signing now uses the local identity.', ok: true })
  }, [])

  return (
    <div className="page-scroll">
      <div className="page-header">
        <h1>Identity and preferences</h1>
        <p>SentinelMesh is ready to use. Configure alerts or manage your identity only when you need to.</p>
      </div>

      <AlertPerimeter />
      <div className="settings-overview">
        <section className="settings-card identity-summary-card">
          <div className="settings-card-icon"><BadgeCheck /></div>
          <div className="settings-card-copy">
            <span className="eyebrow">YOUR IDENTITY</span>
            <h2>{activeIdentity.mode === 'bunker' ? 'Remote signer' : 'Local identity'} {activeIdentity.status === 'ready' ? 'ready' : activeIdentity.status.replace('-', ' ')}</h2>
            <p>Your identity was created automatically. Nothing else is required to browse the map or submit a signed report.</p>
            <div className="identity-key-row">
              <code>{activeNpub || 'Identity loading…'}</code>
              <button className="icon-text-button" onClick={copyNpub} disabled={!activeNpub}><Copy />{copiedNpub ? 'Copied' : 'Copy'}</button>
            </div>
          </div>
          <button className="button-secondary settings-card-action" onClick={() => { setManageTab('signing'); setManageOpen(true) }}>Signing options</button>
        </section>

        <section className="settings-card recovery-summary-card">
          <div className="settings-card-icon recovery"><ShieldCheck /></div>
          <div className="settings-card-copy">
            <span className="eyebrow">SECURITY &amp; RECOVERY</span>
            <h2>{staleBadge === 'none' ? 'Backup current' : staleBadge === 'stale' ? 'Backup needs updating' : 'Create your first backup'}</h2>
            <p>Backups are optional but recommended if you want to recover this identity on another device.</p>
          </div>
          <button className="button-primary settings-card-action" onClick={() => { setManageTab('recovery'); setManageOpen(true) }}><HardDriveDownload /> Manage recovery</button>
        </section>
      </div>

      {manageOpen && (
        <div className="identity-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setManageOpen(false) }}>
          <section className="identity-dialog" role="dialog" aria-modal="true" aria-labelledby="identity-dialog-title">
            <header className="identity-dialog-header">
              <div><span className="eyebrow">ADVANCED IDENTITY</span><h2 id="identity-dialog-title">Manage identity</h2></div>
              <button className="dialog-close" onClick={() => setManageOpen(false)} aria-label="Close identity settings"><X /></button>
            </header>
            <div className="identity-dialog-tabs" role="tablist" aria-label="Identity management sections">
              <button role="tab" aria-selected={manageTab === 'signing'} className={manageTab === 'signing' ? 'active' : ''} onClick={() => setManageTab('signing')}><RadioTower /> Signing</button>
              <button role="tab" aria-selected={manageTab === 'recovery'} className={manageTab === 'recovery' ? 'active' : ''} onClick={() => setManageTab('recovery')}><KeyRound /> Recovery</button>
            </div>

            <div className="identity-dialog-body">
              {manageTab === 'signing' ? (
                <div className="advanced-section">
                  <h3>Active signer</h3>
                  <p>Local signing is the default. A NIP-46 bunker lets another signer approve actions for this identity.</p>
                  <div className={`signer-status ${activeIdentity.status === 'ready' ? 'ready' : ''}`}>
                    <strong>{activeIdentity.mode === 'bunker' ? 'Remote bunker' : 'This device'}</strong>
                    <span>{activeIdentity.status.replace('-', ' ')}</span>
                    <code>{activeNpub || 'Identity pending'}</code>
                    {activeIdentity.error && <small className="form-error">{activeIdentity.error}</small>}
                    {activeIdentity.approvalUrl && activeIdentity.status !== 'ready' && <a href={activeIdentity.approvalUrl} target="_blank" rel="noreferrer">Open signer authorization</a>}
                  </div>
                  {activeIdentity.mode === 'local' ? (
                    <div className="inline-form">
                      <input className="form-control" value={bunkerInput} onChange={event => setBunkerInput(event.target.value)} placeholder="bunker://…" aria-label="Bunker connection URI" disabled={activeIdentity.status === 'connecting'} />
                      <button className="button-primary" onClick={handleConnectBunker} disabled={!bunkerInput.trim() || activeIdentity.status === 'connecting'}>Connect bunker</button>
                    </div>
                  ) : (
                    <div className="button-row">
                      {activeIdentity.status !== 'ready' && <button className="button-secondary" onClick={handleReconnectBunker} disabled={activeIdentity.status === 'connecting'}>Reconnect</button>}
                      <button className="button-danger" onClick={handleDisconnectBunker}>Disconnect and use local</button>
                    </div>
                  )}
                  {signerMsg && <p className={signerMsg.ok ? 'form-success' : 'form-error'}>{signerMsg.text}</p>}
                  {activeIdentity.pubkey && <Nip05IdentitySection pubkey={activeIdentity.pubkey} />}
                </div>
              ) : (
                <div className="advanced-section recovery-sections">
                  <section>
                    <h3>Create encrypted backup</h3>
                    <p>Choose a passphrase of at least 12 characters. It cannot be recovered if lost.</p>
                    <input className="form-control" type="password" value={exportPass} onChange={event => setExportPass(event.target.value)} placeholder="Backup passphrase" disabled={!keypair} />
                    <input className="form-control" type="password" value={exportPass2} onChange={event => setExportPass2(event.target.value)} placeholder="Confirm passphrase" disabled={!keypair} />
                    <button className="button-primary" onClick={handleExport} disabled={!keypair}>Download encrypted backup</button>
                    {shownVaultId && <p className="vault-id">Vault ID: <strong>{shownVaultId}</strong></p>}
                  </section>

                  <section>
                    <h3>Restore a backup</h3>
                    <p>Restoring replaces the identity currently stored on this device.</p>
                    <input type="file" accept="application/json,.json" onChange={event => {
                      const file = event.target.files?.[0]; if (!file) return
                      const passphrase = window.prompt('Enter the passphrase for this backup file:') ?? ''
                      void handleFilePicked(file, passphrase)
                      event.target.value = ''
                    }} />
                    {pendingPayload && <div className="restore-confirmation"><strong>Backup Vault ID: {pendingPayload.vaultId}</strong><p>Confirm this is the backup you expect.</p><div className="button-row"><button className="button-danger" onClick={handleConfirmRestore}>Confirm restore</button><button className="button-secondary" onClick={() => setPendingPayload(null)}>Cancel</button></div></div>}
                  </section>

                  <section>
                    <h3>Local secret key</h3>
                    <p>Only reveal or import a secret key when moving an existing identity. Never share an nsec.</p>
                    <div className="secret-key-row"><code>{showNsec ? nsec : 'nsec1••••••••••••••••••••••••••••••••••••'}</code><button className="button-secondary" onClick={() => setShowNsec(value => !value)}>{showNsec ? 'Hide' : 'Reveal'}</button>{showNsec && <button className="button-secondary" onClick={copyNsec}>{copiedNsec ? 'Copied' : 'Copy'}</button>}</div>
                    <div className="inline-form"><input className="form-control" type="password" value={nsecInput} onChange={event => setNsecInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void handleImport() }} placeholder="Paste nsec1…" /><button className="button-secondary" onClick={handleImport} disabled={!nsecInput.trim()}>Import key</button></div>
                    {importMsg && <p className={importMsg.ok ? 'form-success' : 'form-error'}>{importMsg.text}</p>}
                  </section>

                  <section className="danger-zone">
                    <h3>Replace this identity</h3>
                    <p>Generate a new identity only after backing up the current one. Existing Circle access may be lost.</p>
                    <button className="button-danger" onClick={handleGenerate} disabled={!keypair}>Generate new identity</button>
                  </section>
                  {backupMsg && <p className={backupMsg.ok ? 'form-success' : 'form-error'}>{backupMsg.text}</p>}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
