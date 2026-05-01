import { useState, useCallback } from 'react'

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? ''
const DEFAULT_SATS = 21

interface Props {
  reportId: string
  amountSats?: number
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'invoice'; paymentRequest: string }
  | { status: 'error'; message: string }

export function ZapButton({ reportId, amountSats = DEFAULT_SATS }: Props) {
  const [state, setState] = useState<State>({ status: 'idle' })

  const handleZap = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const res = await fetch(`${API_BASE}/api/zaps/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_id: reportId, amount_sats: amountSats }),
      })
      if (!res.ok) {
        setState({ status: 'error', message: `Request failed (${res.status})` })
        return
      }
      const data = await res.json() as { payment_request: string }
      setState({ status: 'invoice', paymentRequest: data.payment_request })
    } catch {
      setState({ status: 'error', message: 'Network error — please try again' })
    }
  }, [reportId, amountSats])

  const handleClose = useCallback(() => setState({ status: 'idle' }), [])

  const handleCopy = useCallback(() => {
    if (state.status !== 'invoice') return
    navigator.clipboard?.writeText(state.paymentRequest)
  }, [state])

  if (state.status === 'invoice') {
    return (
      <div style={{ marginTop: 8 }}>
        <p style={{ margin: '0 0 4px', fontSize: 11, color: '#555', fontFamily: 'sans-serif' }}>
          ⚡ Lightning invoice ({amountSats} sats) — paste into your wallet or{' '}
          <a href={`lightning:${state.paymentRequest}`} style={{ color: '#F7931A' }}>open wallet</a>
        </p>
        <textarea
          readOnly
          value={state.paymentRequest}
          rows={3}
          style={{ width: '100%', fontSize: 10, fontFamily: 'monospace', resize: 'none', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button onClick={handleCopy} style={btnStyle('#F7931A')}>Copy</button>
          <button onClick={handleClose} style={btnStyle('#999')}>Close</button>
        </div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div style={{ marginTop: 8 }}>
        <p style={{ margin: '0 0 4px', fontSize: 11, color: '#CC0000', fontFamily: 'sans-serif' }}>
          {state.message} — <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={handleClose}>dismiss</span>
        </p>
      </div>
    )
  }

  return (
    <button
      onClick={handleZap}
      disabled={state.status === 'loading'}
      style={btnStyle('#F7931A')}
    >
      {state.status === 'loading' ? '…' : `⚡ ${amountSats} sats`}
    </button>
  )
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', border: 'none', borderRadius: 4,
    padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'sans-serif',
  }
}
