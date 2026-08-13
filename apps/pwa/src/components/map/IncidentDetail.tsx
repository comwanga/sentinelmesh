import { ArrowLeft, Clock3, MapPin, Radio, ShieldCheck, X } from 'lucide-react'
import type { SafetyEvent } from '../../../../../shared/types'
import { trustStateOf } from '../../lib/trust'

export function IncidentDetail({ event, onClose }: { event: SafetyEvent; onClose: () => void }) {
  const trust = trustStateOf(event)
  return <article className="incident-detail">
    <button className="detail-close" onClick={onClose} aria-label="Close incident detail"><X size={18} /></button>
    <span className={`severity-flag ${event.severity.toLowerCase()}`}>{event.severity}</span>
    <p className="eyebrow">FIELD RECORD / {event.event_type.replaceAll('_', ' ')}</p>
    <h2>{event.title}</h2>
    {event.summary && <p className="detail-summary">{event.summary}</p>}
    <dl className="detail-grid">
      <div><dt><MapPin size={14} /> Area</dt><dd>{event.place_name ?? event.county ?? 'Mapped location'}</dd></div>
      <div><dt><Clock3 size={14} /> Started</dt><dd>{new Date(event.started_at).toLocaleString()}</dd></div>
      <div><dt><ShieldCheck size={14} /> Evidence</dt><dd>{trust}</dd></div>
      <div><dt><Radio size={14} /> Sources</dt><dd>{event.source_count ?? 'Not stated'}</dd></div>
    </dl>
    <p className="detail-caution">Impact rings are approximate awareness zones, not evacuation orders.</p>
    <button className="signal-button muted" onClick={onClose}><ArrowLeft size={16} /> Back to field ledger</button>
  </article>
}
