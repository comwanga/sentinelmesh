import { useState, useCallback, useEffect } from 'react'
import { loadIdentity, generateNewIdentity, toNpub, toNsec, importFromNsec, type NostrKeypair } from '../services/nostrService'

export function SettingsPage() {
  const [keypair, setKeypair] = useState<NostrKeypair | null>(null)
  const [copiedNpub, setCopiedNpub] = useState(false)
  const [showNsec, setShowNsec] = useState(false)
  const [copiedNsec, setCopiedNsec] = useState(false)
  const [nsecInput, setNsecInput] = useState('')
  const [importMsg, setImportMsg] = useState<{ text: string; ok: boolean } | null>(null)

  // The persisted identity loads asynchronously from the encrypted vault.
  useEffect(() => { loadIdentity().then(setKeypair) }, [])

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

        {/* No-recovery warning */}
        <div style={{
          fontFamily: "'Courier New', monospace", fontSize: 10, color: '#FF8C00',
          background: '#1a1200', border: '1px solid #2d1b00', borderRadius: 6,
          padding: '8px 10px', margin: '0 0 14px', lineHeight: 1.5,
        }}>
          ⚠ This key is stored only on this device. There is no recovery yet — if you lose this
          device, you lose this identity and your circles. Save your secret key (nsec) somewhere
          safe as a backup.
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
