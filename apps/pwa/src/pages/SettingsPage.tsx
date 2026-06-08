import { useState, useCallback, useEffect } from 'react'
import { loadIdentity, generateNewIdentity, toNpub, toNsec, importFromNsec, type NostrKeypair } from '../services/nostrService'
import { exportBackup, decryptBackup, applyRestore, currentVaultId, type RestoreResult } from '../services/backupService'
import { vaultFingerprint, loadVaultMeta } from '../services/identityStore'
import type { VaultPayload } from '../services/identityStore'

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

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#0B0E14' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1a2035' }}>
        <h1 style={{ fontFamily: "'Courier New', monospace", fontSize: 16, color: '#e2e8f0', margin: 0, letterSpacing: '0.1em' }}>
          Settings
        </h1>
      </div>

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

      {/* ── Privacy First ─────────────────────────── */}
      <section style={{ padding: '20px', borderBottom: '1px solid #1a2035' }}>
        <h2 style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#00E5FF', letterSpacing: '0.1em', margin: '0 0 8px' }}>
          Privacy First
        </h2>
        {[
          'No personal data collected.',
          'No readable location logs.',
          'All reports signed with your Nostr key.',
          'Audio never leaves your device.',
          'Family circles are end-to-end encrypted.',
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
          {['Nostr', 'Bitcoin'].map(proto => (
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
