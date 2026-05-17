import { useState, useCallback } from 'react'
import { loadOrCreateKeypair } from '../services/nostrService'

const keypair = loadOrCreateKeypair()

function truncate(hex: string) {
  return hex.slice(0, 8) + '…' + hex.slice(-8)
}

export function SettingsPage() {
  const [copied, setCopied] = useState(false)
  const [nsecInput, setNsecInput] = useState('')
  const [importError, setImportError] = useState<string | null>(null)

  const copyPubkey = useCallback(() => {
    navigator.clipboard.writeText(keypair.publicKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [])

  const handleImport = useCallback(() => {
    if (!nsecInput.trim()) return
    setImportError('nsec import not yet wired — paste your hex secret key in localStorage "sentinel_nostr_sk" and reload.')
  }, [nsecInput])

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#0B0E14' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #1a2035' }}>
        <h1 style={{ fontFamily: "'Courier New', monospace", fontSize: 16, color: '#e2e8f0', margin: 0, letterSpacing: '0.1em' }}>
          Settings
        </h1>
      </div>

      {/* Identity */}
      <section style={{ padding: '20px', borderBottom: '1px solid #1a2035' }}>
        <h2 style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#00E5FF', letterSpacing: '0.1em', marginBottom: 12, margin: '0 0 12px' }}>
          Identity
        </h2>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', marginBottom: 6 }}>
          NOSTR PUBLIC KEY
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#0d1118', border: '1px solid #1a2035', borderRadius: 6,
          padding: '8px 10px', marginBottom: 12,
        }}>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#e2e8f0', flex: 1, wordBreak: 'break-all' }}>
            {truncate(keypair.publicKey)}
          </span>
          <button
            onClick={copyPubkey}
            style={{
              background: 'none', border: '1px solid #1a2035', borderRadius: 4,
              color: copied ? '#4CAF50' : '#4a5568', fontFamily: "'Courier New', monospace",
              fontSize: 10, padding: '3px 8px', cursor: 'pointer', flexShrink: 0,
            }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', marginBottom: 6 }}>
          IMPORT NSEC (optional)
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="password"
            value={nsecInput}
            onChange={e => setNsecInput(e.target.value)}
            placeholder="nsec1…"
            style={{
              flex: 1, background: '#0d1118', border: '1px solid #1a2035', borderRadius: 4,
              color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 11,
              padding: '6px 8px', outline: 'none',
            }}
          />
          <button
            onClick={handleImport}
            style={{
              background: '#1a2035', border: '1px solid #1a2035', borderRadius: 4,
              color: '#94a3b8', fontFamily: "'Courier New', monospace", fontSize: 11,
              padding: '6px 12px', cursor: 'pointer',
            }}
          >
            Import
          </button>
        </div>
        {importError && (
          <p style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#FF8C00', marginTop: 6 }}>
            {importError}
          </p>
        )}
      </section>

      {/* Privacy */}
      <section style={{ padding: '20px', borderBottom: '1px solid #1a2035' }}>
        <h2 style={{ fontFamily: "'Courier New', monospace", fontSize: 12, color: '#00E5FF', letterSpacing: '0.1em', margin: '0 0 8px' }}>
          Privacy First
        </h2>
        {[
          'No personal data collected.',
          'No readable location logs.',
          'All reports signed with your Nostr key.',
          'Audio never leaves your device.',
        ].map(item => (
          <p key={item} style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568', margin: '4px 0' }}>
            ✓ {item}
          </p>
        ))}
      </section>

      {/* Open Protocols */}
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
