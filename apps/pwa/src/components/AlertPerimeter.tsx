import { useState } from 'react'
import { BellRing, Crosshair, MapPin, ShieldCheck } from 'lucide-react'
import { loadPushPreferences, usePushSubscription, type PushPreferences, type PushSeverity } from '../hooks/usePushSubscription'

export function AlertPerimeter() {
  const push = usePushSubscription()
  const [preferences, setPreferences] = useState<PushPreferences>(loadPushPreferences)
  const [locationError, setLocationError] = useState<string | null>(null)

  async function locate() {
    setLocationError(null)
    try {
      const center = await push.locate()
      setPreferences(value => ({ ...value, center }))
    }
    catch { setLocationError('Location access is needed to build a private alert perimeter.') }
  }

  return (
    <section className="perimeter-panel" aria-labelledby="alert-perimeter-title">
      <div className="perimeter-orbit" aria-hidden="true"><BellRing size={24} /></div>
      <div className="perimeter-copy">
        <span className="eyebrow">PRIVATE AND OPT-IN</span>
        <h2 id="alert-perimeter-title">Nearby alert perimeter</h2>
        <p>Draw a listening radius around your current area. Only confirmed incidents meeting your severity threshold are queued for delivery.</p>
      </div>
      <div className="perimeter-grid">
        <button className="atlas-control location-control" onClick={locate} type="button">
          <Crosshair size={17} />
          <span><strong>{preferences.center ? 'Perimeter anchored' : 'Use current area'}</strong><small>{preferences.center ? `${preferences.center.lat.toFixed(2)}, ${preferences.center.lng.toFixed(2)} (coarse)` : 'Requested only when you tap'}</small></span>
        </button>
        <label className="atlas-field"><span>Minimum signal</span><select value={preferences.minSeverity} onChange={event => setPreferences(value => ({ ...value, minSeverity: event.target.value as PushSeverity }))}>{['MEDIUM', 'HIGH', 'CRITICAL'].map(level => <option key={level}>{level}</option>)}</select></label>
        <label className="atlas-field radius-field"><span>Radius <strong>{preferences.radiusKm} km</strong></span><input type="range" min="2" max="50" step="1" value={preferences.radiusKm} onChange={event => setPreferences(value => ({ ...value, radiusKm: Number(event.target.value) }))} /></label>
      </div>
      <div className="perimeter-actions">
        {push.state === 'enabled'
          ? <><button className="signal-button muted" onClick={() => void push.enable(preferences)} disabled={!preferences.center}><MapPin size={16} /> Update perimeter</button><button className="text-button" onClick={() => void push.disable()}>Disable alerts</button></>
          : <button className="signal-button" onClick={() => void push.enable(preferences)} disabled={!preferences.center || push.state === 'working' || push.state === 'unsupported'}><ShieldCheck size={16} /> {push.state === 'working' ? 'Enabling alerts…' : 'Enable nearby alerts'}</button>}
        <span className={`perimeter-status ${push.state}`}><i />{push.state === 'enabled' ? 'Listening' : push.state === 'denied' ? 'Permission blocked in browser' : push.state === 'unsupported' ? 'Push unavailable on this device' : 'Silent until enabled'}</span>
      </div>
      {(locationError || push.error) && <p className="perimeter-error" role="alert">{locationError ?? push.error}</p>}
    </section>
  )
}
