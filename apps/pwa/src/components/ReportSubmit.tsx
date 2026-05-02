import { useState, useCallback, useRef } from 'react'
import { loadOrCreateKeypair, signReport } from '../services/nostrService'
import { compressAndStrip, blurFaces, uploadToIPFS } from '../services/photoService'

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? ''

const REPORT_TYPES = [
  'ROAD_BLOCKED', 'FLOODING', 'SECURITY_INCIDENT', 'FIRE',
  'PROTEST_MARCH', 'ACCIDENT', 'INFRASTRUCTURE', 'ALL_CLEAR', 'OTHER',
]

interface Props {
  onClose: () => void
  linkedEventId?: string
}

type SubmitState = 'idle' | 'locating' | 'submitting' | 'error'

export function ReportSubmit({ onClose, linkedEventId }: Props) {
  const [reportType, setReportType] = useState('FLOODING')
  const [description, setDescription] = useState('')
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleSubmit = useCallback(async () => {
    setSubmitState('locating')
    setErrorMsg(null)

    let lat = 0
    let lng = 0
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
      )
      lat = pos.coords.latitude
      lng = pos.coords.longitude
    } catch {
      setSubmitState('error')
      setErrorMsg('Location unavailable — please enable GPS and try again')
      return
    }

    setSubmitState('submitting')

    let photoCid: string | null = null
    const file = fileRef.current?.files?.[0]
    if (file) {
      try {
        const compressed = await compressAndStrip(file)
        const canvas = document.createElement('canvas')
        const img = await createImageBitmap(compressed)
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.drawImage(img as CanvasImageSource, 0, 0)
        await blurFaces(canvas)
        const finalBlob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob null')), 'image/jpeg', 0.85)
        )
        photoCid = await uploadToIPFS(finalBlob)
      } catch {
        // Photo processing failed — submit without photo
      }
    }

    const keypair = loadOrCreateKeypair()
    const postBody = {
      report_type: reportType,
      description: description || null,
      lat, lng,
      photo_ipfs_cid: photoCid,
      linked_event_id: linkedEventId ?? null,
    }
    const nostrEvent = signReport(postBody, keypair.secretKey)

    try {
      const res = await fetch(`${API_BASE}/api/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...postBody,
          nostr_pubkey: keypair.publicKey,
          nostr_event: nostrEvent,
        }),
      })
      if (!res.ok) {
        setSubmitState('error')
        setErrorMsg(`Submit failed (${res.status}) — please try again`)
        return
      }
      onClose()
    } catch {
      setSubmitState('error')
      setErrorMsg('Network error — please try again')
    }
  }, [reportType, description, linkedEventId, onClose])

  return (
    <div style={containerStyle}>
      <h3 style={{ margin: '0 0 12px', fontSize: 14, fontFamily: 'sans-serif' }}>Submit Report</h3>

      <label style={labelStyle}>Type</label>
      <select
        value={reportType}
        onChange={e => setReportType(e.target.value)}
        style={inputStyle}
      >
        {REPORT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
      </select>

      <label style={labelStyle}>Description (optional)</label>
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        rows={3}
        style={{ ...inputStyle, resize: 'none' }}
        placeholder="Describe what you see…"
      />

      <label style={labelStyle}>Photo (optional)</label>
      <input ref={fileRef} type="file" accept="image/*" style={{ marginBottom: 8, fontSize: 12 }} />
      <p style={{ margin: '0 0 12px', fontSize: 10, color: '#888', fontFamily: 'sans-serif' }}>
        EXIF data and faces are removed in your browser before upload.
      </p>

      {errorMsg && (
        <p style={{ margin: '0 0 8px', color: '#CC0000', fontSize: 12, fontFamily: 'sans-serif' }}>
          {errorMsg}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleSubmit}
          disabled={submitState === 'locating' || submitState === 'submitting'}
          style={btnStyle('#2E7D32')}
        >
          {submitState === 'locating' ? 'Getting location…' :
           submitState === 'submitting' ? 'Submitting…' : 'Submit'}
        </button>
        <button onClick={onClose} style={btnStyle('#999')}>Cancel</button>
      </div>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 8, padding: 16,
  boxShadow: '0 2px 12px rgba(0,0,0,0.15)', fontFamily: 'sans-serif',
  maxWidth: 320,
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: '#555', marginBottom: 2,
}
const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 12, padding: '4px 6px', marginBottom: 8,
  border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box',
}
function btnStyle(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', border: 'none', borderRadius: 4,
    padding: '6px 14px', fontSize: 12, cursor: 'pointer',
  }
}
