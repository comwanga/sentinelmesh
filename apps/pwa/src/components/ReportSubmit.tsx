import { useState, useCallback, useRef } from 'react'
import { signBoundEvent, reportBindingContent } from '../services/nostrService'
import { compressAndStrip, blurFaces, uploadToIPFS } from '../services/photoService'
import { experimentalFeatures } from '../config/features'
import { parseReport } from '../services/safetyDataApi'
import { reportReceived } from '../store/reportSlice'
import { useAppDispatch } from '../store'

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
  const dispatch = useAppDispatch()
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
    const file = experimentalFeatures.photos ? fileRef.current?.files?.[0] : undefined
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

    const postBody = {
      report_type: reportType,
      description: description || null,
      lat, lng,
      photo_ipfs_cid: photoCid,
      linked_event_id: linkedEventId ?? null,
    }
    try {
      const nostrEvent = await signBoundEvent(reportBindingContent(reportType, lat, lng, description || null))
      const res = await fetch(`${API_BASE}/api/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          ...postBody,
          nostr_pubkey: nostrEvent.pubkey,
          nostr_event: nostrEvent,
        }),
      })
      if (!res.ok) {
        setSubmitState('error')
        setErrorMsg(`Submit failed (${res.status}) — please try again`)
        return
      }
      const report = parseReport(await res.json())
      if (report) dispatch(reportReceived(report))
      onClose()
    } catch (error) {
      setSubmitState('error')
      setErrorMsg(error instanceof Error ? error.message : 'Network error — please try again')
    }
  }, [reportType, description, linkedEventId, onClose, dispatch])

  return (
    <div style={containerStyle}>
      <h3 style={{ margin: '0 0 14px', fontSize: 13, fontFamily: "'Courier New', monospace", color: '#e2e8f0', letterSpacing: '0.08em' }}>
        SUBMIT REPORT
      </h3>

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

      {experimentalFeatures.photos && (
        <>
          <label style={labelStyle}>Photo (experimental)</label>
          <input ref={fileRef} type="file" accept="image/*" style={{ marginBottom: 4, fontSize: 11, color: '#94a3b8', width: '100%' }} />
          <p style={{ margin: '0 0 12px', fontSize: 10, color: '#4a5568', fontFamily: "'Courier New', monospace" }}>
            EXIF removal and face blurring are best effort. Review the image before upload.
          </p>
        </>
      )}

      {errorMsg && (
        <p style={{ margin: '0 0 8px', color: '#FF2D2D', fontSize: 11, fontFamily: "'Courier New', monospace" }}>
          {errorMsg}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleSubmit}
          disabled={submitState === 'locating' || submitState === 'submitting'}
          style={btnStyle('#1B5E20', '#4CAF50')}
        >
          {submitState === 'locating' ? 'Getting location…' :
           submitState === 'submitting' ? 'Submitting…' : 'Submit'}
        </button>
        <button onClick={onClose} style={btnStyle('#1a2035', '#4a5568')}>Cancel</button>
      </div>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  background: '#0d1118', borderRadius: 8, padding: 16,
  border: '1px solid #1a2035',
  fontFamily: "'Courier New', monospace",
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, color: '#4a5568', marginBottom: 3, letterSpacing: '0.06em',
}
const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 12, padding: '6px 8px', marginBottom: 10,
  border: '1px solid #1a2035', borderRadius: 4, boxSizing: 'border-box',
  background: '#0B0E14', color: '#e2e8f0', fontFamily: "'Courier New', monospace",
  outline: 'none',
}
function btnStyle(bg: string, color: string): React.CSSProperties {
  return {
    flex: 1, background: bg, color, border: `1px solid ${color}33`, borderRadius: 4,
    padding: '7px 0', fontSize: 11, cursor: 'pointer', fontFamily: "'Courier New', monospace",
    letterSpacing: '0.05em',
  }
}
