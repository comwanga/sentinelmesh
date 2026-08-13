import { useCallback, useEffect, useState } from 'react'
import { getNip05Identity, removeNip05Identity, verifyNip05Identity, type Nip05Status } from '../services/nip05Service'

interface Props {
  pubkey: string
}

const textStyle = { fontFamily: "'Courier New', monospace", fontSize: 10 } as const

export function Nip05IdentitySection({ pubkey }: Props) {
  const [identity, setIdentity] = useState<Nip05Status | null>(null)
  const [identifier, setIdentifier] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    let current = true
    setLoading(true)
    setMessage(null)
    void getNip05Identity()
      .then(result => {
        if (!current) return
        setIdentity(result)
        setIdentifier(result?.identifier ?? '')
      })
      .catch(error => {
        if (current) setMessage({ text: (error as Error).message, ok: false })
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => { current = false }
  }, [pubkey])

  const verify = useCallback(async () => {
    if (!/^[A-Za-z0-9_.-]+@[^\s/@]+\.[^\s/@]+$/.test(identifier.trim())) {
      setMessage({ text: 'Enter a valid name@domain identifier.', ok: false })
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const result = await verifyNip05Identity(identifier.trim())
      setIdentity(result)
      setIdentifier(result.identifier)
      setMessage({ text: 'NIP-05 identity verified for this local key.', ok: true })
    } catch (error) {
      setMessage({ text: (error as Error).message, ok: false })
    } finally {
      setLoading(false)
    }
  }, [identifier])

  const remove = useCallback(async () => {
    if (!window.confirm('Remove this NIP-05 identity from SentinelMesh?')) return
    setLoading(true)
    setMessage(null)
    try {
      await removeNip05Identity()
      setIdentity(null)
      setIdentifier('')
      setMessage({ text: 'NIP-05 identity removed. Your local key is unchanged.', ok: true })
    } catch (error) {
      setMessage({ text: (error as Error).message, ok: false })
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <div style={{ borderTop: '1px solid #1a2035', margin: '14px 0', paddingTop: 14 }}>
      <label htmlFor="nip05-identifier" style={{ ...textStyle, display: 'block', color: '#4a5568', letterSpacing: '0.06em', marginBottom: 6 }}>
        OPTIONAL NIP-05 IDENTITY
      </label>
      <p style={{ ...textStyle, color: '#4a5568', margin: '0 0 8px', lineHeight: 1.5 }}>
        Verify a name@domain label that already maps to this public key. Your local key remains your signing identity, and this label is not used for reputation.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input
          id="nip05-identifier"
          type="text"
          value={identifier}
          onChange={event => setIdentifier(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') void verify() }}
          placeholder="name@example.com"
          disabled={loading}
          aria-invalid={message?.ok === false}
          aria-describedby="nip05-status"
          style={{ flex: '1 1 220px', background: '#0d1118', border: '1px solid #1a2035', borderRadius: 4, color: '#e2e8f0', ...textStyle, fontSize: 11, padding: '7px 10px' }}
        />
        <button onClick={() => void verify()} disabled={loading || !identifier.trim()}
          style={{ background: '#1a2035', border: '1px solid #1a2035', borderRadius: 4, color: '#94a3b8', ...textStyle, padding: '7px 14px', cursor: loading ? 'wait' : 'pointer' }}>
          {identity ? 'Refresh' : 'Verify'}
        </button>
        {identity && <button onClick={() => void remove()} disabled={loading}
          style={{ background: 'none', border: '1px solid #FF8C00', borderRadius: 4, color: '#FF8C00', ...textStyle, padding: '7px 14px', cursor: loading ? 'wait' : 'pointer' }}>
          Remove
        </button>}
      </div>
      <div id="nip05-status" aria-live="polite" style={{ ...textStyle, marginTop: 8, color: message ? (message.ok ? '#4CAF50' : '#FF2D2D') : identity?.verified ? '#4CAF50' : '#FF8C00' }}>
        {message?.text ?? (identity ? `${identity.verified ? 'Verified' : 'Verification expired'} · valid until ${new Date(identity.valid_until).toLocaleString()}` : loading ? 'Loading identity…' : '')}
      </div>
    </div>
  )
}
