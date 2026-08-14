import { useCallback, useEffect, useState } from 'react'
import { getNip05Identity, removeNip05Identity, verifyNip05Identity, type Nip05Status } from '../services/nip05Service'

interface Props {
  pubkey: string
}

const textStyle = { fontSize: 11 } as const

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
      setMessage({ text: 'NIP-05 identity verified for the active key.', ok: true })
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
      setMessage({ text: 'NIP-05 identity removed. Your signing key is unchanged.', ok: true })
    } catch (error) {
      setMessage({ text: (error as Error).message, ok: false })
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <div style={{ borderTop: '1px solid #d9e1dc', margin: '16px 0 0', paddingTop: 16 }}>
      <label htmlFor="nip05-identifier" style={{ ...textStyle, display: 'block', color: '#48635e', fontWeight: 800, marginBottom: 6 }}>
        Optional NIP-05 identity
      </label>
      <p style={{ ...textStyle, color: '#687c78', margin: '0 0 9px', lineHeight: 1.5 }}>
        Verify a name@domain label that already maps to the active public key. This label is not used for reputation.
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
          className="form-control"
          style={{ flex: '1 1 220px' }}
        />
        <button onClick={() => void verify()} disabled={loading || !identifier.trim()}
          className="button-secondary">
          {identity ? 'Refresh' : 'Verify'}
        </button>
        {identity && <button onClick={() => void remove()} disabled={loading}
          className="button-danger">
          Remove
        </button>}
      </div>
      <div id="nip05-status" aria-live="polite" style={{ ...textStyle, marginTop: 8, color: message ? (message.ok ? '#25845b' : '#c83e3e') : identity?.verified ? '#25845b' : '#a76510' }}>
        {message?.text ?? (identity ? `${identity.verified ? 'Verified' : 'Verification expired'} · valid until ${new Date(identity.valid_until).toLocaleString()}` : loading ? 'Loading identity…' : '')}
      </div>
    </div>
  )
}
