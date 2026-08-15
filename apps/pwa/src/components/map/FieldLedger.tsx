import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ListFilter, Plus, Radio } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SafetyEvent } from '../../../../../shared/types'
import { AlertCard, safetyEventToCardProps } from '../shared/AlertCard'
import { IncidentDetail } from './IncidentDetail'

export function FieldLedger({ events, selected, onSelect, mobile }: { events: SafetyEvent[]; selected: SafetyEvent | null; onSelect: (event: SafetyEvent | null) => void; mobile: boolean }) {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const critical = events.filter(event => event.severity === 'CRITICAL').length
  const hidden = mobile ? !open : collapsed

  return <aside className={`field-ledger ${mobile ? 'mobile' : ''} ${open ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`} aria-label="Incident field ledger">
    {mobile && <button className="ledger-handle" onClick={() => setOpen(value => !value)} aria-expanded={open}><i /> <span><strong>{events.length}</strong> in view · <b>{critical} critical</b></span>{open ? <ChevronDown /> : <ChevronUp />}</button>}

    {!mobile && collapsed && (
      <button className="ledger-rail" onClick={() => setCollapsed(false)} aria-expanded={false} title="Expand field ledger" aria-label="Expand field ledger">
        <ChevronLeft />
        <span className="ledger-rail-label">LIVE FIELD LEDGER</span>
        <strong>{events.length}</strong>
      </button>
    )}

    {!hidden && <>
      {selected ? <IncidentDetail event={selected} onClose={() => onSelect(null)} /> : <>
        <header className="ledger-header"><div><p className="eyebrow">LIVE FIELD LEDGER</p><h2>Incidents in view</h2></div><div className="ledger-header-actions">{!mobile && <button className="ledger-collapse" onClick={() => setCollapsed(true)} aria-label="Collapse field ledger" title="Collapse for a wider map"><ChevronRight /></button>}<ListFilter size={18} /></div></header>
        <div className="ledger-summary"><span><strong>{events.length}</strong> mapped</span><span><strong>{critical}</strong> critical</span><span><strong>{events.filter(e => e.trust_state === 'confirmed').length}</strong> confirmed</span></div>
        <div className="ledger-list">{events.length ? events.map(event => <AlertCard key={event.id} {...safetyEventToCardProps(event)} onClick={() => onSelect(event)} />) : <div className="ledger-empty"><Radio /><strong>Quiet viewport</strong><span>No active records in this map area.</span></div>}</div>
        <button className="report-field-action" onClick={() => navigate('/reports')}><Plus size={19} /> Report what you see</button>
      </>}
    </>}
  </aside>
}
