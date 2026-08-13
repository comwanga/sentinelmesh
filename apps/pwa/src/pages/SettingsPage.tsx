import { useState, useCallback, useEffect } from 'react'
import { loadIdentity, generateNewIdentity, toNpub, toNsec, importFromNsec, hexFromNpubOrHex, type NostrKeypair } from '../services/nostrService'
import { issueVouch } from '../services/vouchService'
import { exportBackup, decryptBackup, applyRestore, currentVaultId, type RestoreResult } from '../services/backupService'
import { vaultFingerprint, loadVaultMeta } from '../services/identityStore'
import type { VaultPayload } from '../services/identityStore'
import { Nip05IdentitySection } from '../components/Nip05IdentitySection'
import { useActiveIdentity } from '../hooks/useActiveIdentity'
import { connectBunker, disconnectBunker, reconnectBunker, refreshLocalIdentity } from '../services/signerService'

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

  const copyNpub = useCallback(() => {
    navigator.clipboard.writeText(npub).then(() => {
      setCopiedNpub(true); setTimeout(() => setCopiedNpub(false), 2000)
    })
  }, [npub])

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

  const [vouchInput, setVouchInput] = useState('')
  const [vouchMsg, setVouchMsg] = useState<string | null>(null)

  const handleVouch = useCallback(async () => {
    const hex = hexFromNpubOrHex(vouchInput.trim())
    if (!hex) {
      setVouchMsg('Enter a valid npub or hex pubkey')
      return
    }
    const ok = await issueVouch(hex)
    setVouchMsg(ok ? 'Vouch submitted.' : 'Vouch failed (you may not be eligible to vouch, or already vouched).')
    setTimeout(() => setVouchMsg(null), 4000)
  }, [vouchInput])

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
    <div style={{ height: '100%', overflowY: 'auto', background: '#0B0E14' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1a2035' }}>
        <h1 style={{ fontFamily: "'Courier New', monospace", fontSize: 16, color: '#e2e8f0', margin: 0, letterSpacing: '0.1em' }}>
          Settings
        </h1>
      </div>

      <section style={{ padding: '20px', borderBottom: '1px solid #1a2035' }}>
        <h2 style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#BB86FC', letterSpacing: '0.1em', margin: '0 0 8px' }}>
          ACTIVE SIGNER
        </h2>
        <p style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', margin: '0 0 12px', lineHeight: 1.5 }}>
          Local signing is the default. Connect a NIP-46 bunker to use one remote identity for reports, votes, vouches, NIP-05, and request authentication.
        </p>
        <div style={{ background: '#0d1118', border: `1px solid ${activeIdentity.mode === 'bunker' ? '#BB86FC' : '#1a2035'}`, borderRadius: 6, padding: '10px 12px', marginBottom: 12 }}>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: activeIdentity.status === 'ready' ? '#4CAF50' : '#FF8C00', marginBottom: 5 }}>
            {activeIdentity.mode.toUpperCase()} / {activeIdentity.status.toUpperCase().replace('-', ' ')}
          </div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#94a3b8', wordBreak: 'break-all' }}>
            {activeIdentity.pubkey || 'Identity pending'}
          </div>
          {activeIdentity.error && <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#FF2D2D', marginTop: 7 }}>{activeIdentity.error}</div>}
          {activeIdentity.approvalUrl && activeIdentity.status !== 'ready' && (
            <a href={activeIdentity.approvalUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', fontFamily: "'Courier New', monospace", fontSize: 10, color: '#00E5FF', marginTop: 8 }}>
              Open signer authorization
            </a>
          )}
        </div>
        {activeIdentity.mode === 'local' ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={bunkerInput} onChange={event => setBunkerInput(event.target.value)} placeholder="bunker://..." aria-label="Bunker connection URI" disabled={activeIdentity.status === 'connecting'}
              style={{ flex: '1 1 320px', minWidth: 0, background: '#0d1118', border: '1px solid #1a2035', borderRadius: 4, color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 11, padding: '7px 10px' }} />
            <button onClick={handleConnectBunker} disabled={!bunkerInput.trim() || activeIdentity.status === 'connecting'} style={{ background: '#241834', border: '1px solid #BB86FC', borderRadius: 4, color: '#BB86FC', fontFamily: "'Courier New', monospace", fontSize: 10, padding: '7px 14px', cursor: bunkerInput.trim() ? 'pointer' : 'not-allowed' }}>
              Connect bunker
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {activeIdentity.status !== 'ready' && <button onClick={handleReconnectBunker} disabled={activeIdentity.status === 'connecting'} style={{ background: '#241834', border: '1px solid #BB86FC', borderRadius: 4, color: '#BB86FC', fontFamily: "'Courier New', monospace", fontSize: 10, padding: '7px 14px', cursor: 'pointer' }}>Reconnect</button>}
            <button onClick={handleDisconnectBunker} style={{ background: 'none', border: '1px solid #FF8C00', borderRadius: 4, color: '#FF8C00', fontFamily: "'Courier New', monospace", fontSize: 10, padding: '7px 14px', cursor: 'pointer' }}>Disconnect and use local</button>
          </div>
        )}
        {activeIdentity.mode === 'bunker' && <p style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#FF8C00', margin: '10px 0 0' }}>Circles are disabled in remote mode because their NIP-44 keys belong to the local identity.</p>}
        {signerMsg && <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: signerMsg.ok ? '#4CAF50' : '#FF2D2D', marginTop: 9 }}>{signerMsg.text}</div>}
        {activeIdentity.pubkey && <Nip05IdentitySection pubkey={activeIdentity.pubkey} />}
      </section>

      {/* ── Identity ─────────────────────────────── */}
      <section style={{ padding: '20px', borderBottom: '1px solid #1a2035' }}>
        <h2 style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#00E5FF', letterSpacing: '0.1em', margin: '0 0 14px' }}>
          Nostr Identity
        </h2>
        <p style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', margin: '0 0 12px' }}>
          Your identity is a Nostr key pair stored encrypted on this device. It persists across reloads
          and is used to sign reports and authenticate with circles.
        </p>

        {/* npub */}
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', marginBottom: 4, letterSpacing: '0.06em' }}>
          PUBLIC KEY (npub)
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div style={{
            flex: 1, background: '#0d1118', border: '1px solid #1a2035', borderRadius: 6,
            padding: '8px 10px', fontFamily: "'Courier New', monospace", fontSize: 11, color: '#e2e8f0',
            wordBreak: 'break-all', lineHeight: 1.5,
          }}>
            {npub}
          </div>
          <button
            onClick={copyNpub}
            style={{
              flexShrink: 0, background: copiedNpub ? '#1B5E20' : 'none',
              border: '1px solid ' + (copiedNpub ? '#4CAF50' : '#1a2035'), borderRadius: 4,
              color: copiedNpub ? '#4CAF50' : '#4a5568', fontFamily: "'Courier New', monospace",
              fontSize: 10, padding: '5px 10px', cursor: 'pointer',
            }}
          >
            {copiedNpub ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {/* nsec reveal */}
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', marginBottom: 4, letterSpacing: '0.06em' }}>
          SECRET KEY (nsec) <span style={{ color: '#FF8C00' }}>⚠ never share</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div style={{
            flex: 1, background: '#0d1118', border: '1px solid #2d1b00', borderRadius: 6,
            padding: '8px 10px', fontFamily: "'Courier New', monospace", fontSize: 11,
            color: showNsec ? '#FF8C00' : '#2d3748', wordBreak: 'break-all', lineHeight: 1.5,
          }}>
            {showNsec ? nsec : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
            <button
              onClick={() => setShowNsec(v => !v)}
              style={{
                background: 'none', border: '1px solid #1a2035', borderRadius: 4,
                color: '#4a5568', fontFamily: "'Courier New', monospace", fontSize: 10,
                padding: '4px 8px', cursor: 'pointer',
              }}
            >
              {showNsec ? 'Hide' : 'Show'}
            </button>
            {showNsec && (
              <button
                onClick={copyNsec}
                style={{
                  background: copiedNsec ? '#2d1b00' : 'none',
                  border: '1px solid ' + (copiedNsec ? '#FF8C00' : '#1a2035'), borderRadius: 4,
                  color: copiedNsec ? '#FF8C00' : '#4a5568', fontFamily: "'Courier New', monospace",
                  fontSize: 10, padding: '4px 8px', cursor: 'pointer',
                }}
              >
                {copiedNsec ? 'Copied!' : 'Copy'}
              </button>
            )}
          </div>
        </div>

        {/* ── Backup & Recovery ─────────────────────────────── */}
        <div style={{ borderTop: '1px solid #1a2035', margin: '14px 0', paddingTop: 14 }}>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', letterSpacing: '0.06em', marginBottom: 8 }}>
            BACKUP &amp; RECOVERY
            {staleBadge === 'stale' && <span style={{ color: '#FF8C00', marginLeft: 8 }}>⚠ Backup out of date — re-export</span>}
            {staleBadge === 'no-backup' && <span style={{ color: '#FF8C00', marginLeft: 8 }}>⚠ No backup yet</span>}
          </div>

          {/* Export */}
          <input type="password" value={exportPass} onChange={e => setExportPass(e.target.value)}
            placeholder="Backup passphrase (min 12 chars)" disabled={!keypair}
            style={{ width: '100%', boxSizing: 'border-box', background: '#0d1118', border: '1px solid #1a2035', borderRadius: 4, color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 11, padding: '7px 10px', marginBottom: 6 }} />
          <input type="password" value={exportPass2} onChange={e => setExportPass2(e.target.value)}
            placeholder="Confirm passphrase" disabled={!keypair}
            style={{ width: '100%', boxSizing: 'border-box', background: '#0d1118', border: '1px solid #1a2035', borderRadius: 4, color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 11, padding: '7px 10px', marginBottom: 6 }} />
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#FF8C00', marginBottom: 8 }}>
            There is no way to recover this passphrase. Store it safely — without it the backup cannot be opened.
          </div>
          <button onClick={handleExport} disabled={!keypair}
            style={{ background: 'none', border: '1px solid #1a2035', borderRadius: 4, color: keypair ? '#94a3b8' : '#4a5568', fontFamily: "'Courier New', monospace", fontSize: 10, padding: '6px 14px', cursor: keypair ? 'pointer' : 'not-allowed' }}>
            Export encrypted backup
          </button>
          {shownVaultId && (
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#00E5FF', marginTop: 8 }}>
              Vault ID: <strong>{shownVaultId}</strong> — note this to verify your backup later.
            </div>
          )}

          {/* Import */}
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', letterSpacing: '0.06em', margin: '14px 0 6px' }}>
            RESTORE FROM BACKUP
          </div>
          <input type="file" accept="application/json,.json"
            onChange={e => {
              const f = e.target.files?.[0]; if (!f) return
              const pass = window.prompt('Enter the passphrase for this backup file:') ?? ''
              void handleFilePicked(f, pass)
              e.target.value = ''
            }}
            style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#94a3b8' }} />

          {pendingPayload && (
            <div style={{ background: '#0d1118', border: '1px solid #2d1b00', borderRadius: 6, padding: '8px 10px', marginTop: 8 }}>
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#00E5FF', marginBottom: 6 }}>
                Backup Vault ID: <strong>{pendingPayload.vaultId}</strong>
              </div>
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#FF8C00', marginBottom: 8 }}>
                Confirm this matches the Vault ID you expect. Restoring REPLACES the identity on this device.
              </div>
              <button onClick={handleConfirmRestore}
                style={{ background: 'none', border: '1px solid #FF8C00', borderRadius: 4, color: '#FF8C00', fontFamily: "'Courier New', monospace", fontSize: 10, padding: '6px 14px', cursor: 'pointer', marginRight: 8 }}>
                Confirm restore
              </button>
              <button onClick={() => setPendingPayload(null)}
                style={{ background: 'none', border: '1px solid #1a2035', borderRadius: 4, color: '#4a5568', fontFamily: "'Courier New', monospace", fontSize: 10, padding: '6px 14px', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          )}

          {backupMsg && (
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, marginTop: 8, color: backupMsg.ok ? '#4CAF50' : '#FF2D2D' }}>
              {backupMsg.text}
            </div>
          )}
        </div>

        {/* Import nsec */}
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', marginBottom: 6, letterSpacing: '0.06em' }}>
          IMPORT EXISTING KEY
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: importMsg ? 6 : 14 }}>
          <input
            type="password"
            value={nsecInput}
            onChange={e => setNsecInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleImport() }}
            placeholder="Paste nsec1…"
            style={{
              flex: 1, background: '#0d1118', border: '1px solid #1a2035', borderRadius: 4,
              color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 11,
              padding: '7px 10px', outline: 'none',
            }}
          />
          <button
            onClick={handleImport}
            disabled={!keypair}
            style={{
              background: '#1a2035', border: '1px solid #1a2035', borderRadius: 4,
              color: '#94a3b8', fontFamily: "'Courier New', monospace", fontSize: 11,
              padding: '7px 14px', cursor: keypair ? 'pointer' : 'not-allowed',
              opacity: keypair ? 1 : 0.5, flexShrink: 0,
            }}
          >
            Import
          </button>
        </div>
        {importMsg && (
          <div style={{
            fontFamily: "'Courier New', monospace", fontSize: 10, marginBottom: 14,
            color: importMsg.ok ? '#4CAF50' : '#FF2D2D',
          }}>
            {importMsg.text}
          </div>
        )}

        {/* Generate new key */}
        <button
          onClick={handleGenerate}
          disabled={!keypair}
          style={{
            background: 'none', border: '1px solid #1a2035', borderRadius: 4,
            color: '#4a5568', fontFamily: "'Courier New', monospace", fontSize: 10,
            padding: '6px 14px', cursor: keypair ? 'pointer' : 'not-allowed',
            opacity: keypair ? 1 : 0.5, letterSpacing: '0.05em',
          }}
        >
          Generate new key (resets identity)
        </button>
      </section>

      {/* ── Vouch for a key ──────────────────────── */}
      <section style={{ padding: '20px', borderBottom: '1px solid #1a2035' }}>
        <h2 style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#00E5FF', letterSpacing: '0.1em', margin: '0 0 8px' }}>
          VOUCH FOR A KEY
        </h2>
        <p style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', margin: '0 0 12px', lineHeight: 1.5 }}>
          Vouch for someone you know to be a real person. This is a public attestation.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: vouchMsg ? 6 : 0 }}>
          <input
            type="text"
            value={vouchInput}
            onChange={e => setVouchInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleVouch() }}
            placeholder="npub1… or hex pubkey"
            style={{
              flex: 1, background: '#0d1118', border: '1px solid #1a2035', borderRadius: 4,
              color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 11,
              padding: '7px 10px', outline: 'none',
            }}
          />
          <button
            onClick={handleVouch}
            disabled={!vouchInput.trim()}
            style={{
              background: '#1a2035', border: '1px solid #1a2035', borderRadius: 4,
              color: '#94a3b8', fontFamily: "'Courier New', monospace", fontSize: 11,
              padding: '7px 14px', cursor: vouchInput.trim() ? 'pointer' : 'not-allowed',
              opacity: vouchInput.trim() ? 1 : 0.5, flexShrink: 0,
            }}
          >
            Vouch
          </button>
        </div>
        {vouchMsg && (
          <div style={{
            fontFamily: "'Courier New', monospace", fontSize: 10,
            color: vouchMsg.startsWith('Vouch submitted') ? '#4CAF50' : '#FF8C00',
          }}>
            {vouchMsg}
          </div>
        )}
      </section>

      {/* ── Data handling ─────────────────────────── */}
      <section style={{ padding: '20px', borderBottom: '1px solid #1a2035' }}>
        <h2 style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#00E5FF', letterSpacing: '0.1em', margin: '0 0 8px' }}>
          Current Data Handling
        </h2>
        {[
          'No name, email, or phone number is required; an optional NIP-05 name@domain label is stored when you verify one.',
          'Incident locations are sent to provide map and report features.',
          'All reports signed with your Nostr key.',
          'Experimental features are disabled in this release.',
        ].map(item => (
          <p key={item} style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568', margin: '4px 0' }}>
            ✓ {item}
          </p>
        ))}
      </section>

      {/* ── Open Protocols ───────────────────────── */}
      <section style={{ padding: '20px' }}>
        <h2 style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#00E5FF', letterSpacing: '0.1em', margin: '0 0 8px' }}>
          Built on Open Protocols
        </h2>
        <div style={{ display: 'flex', gap: 12 }}>
          {['Nostr'].map(proto => (
            <span key={proto} style={{
              fontFamily: "'Courier New', monospace", fontSize: 10, padding: '4px 10px',
              border: '1px solid #1a2035', borderRadius: 6, color: '#BB86FC',
            }}>{proto}</span>
          ))}
        </div>
      </section>
    </div>
  )
}
