import { useState } from 'react'
import { Marker, Popup } from 'react-map-gl'
import { createSelector } from '@reduxjs/toolkit'
import { useAppSelector } from '../store'
import type { RootState } from '../store'
import { MapCanvas } from '../components/MapCanvas'
import EventMarker from '../components/EventMarker'
import { SafeRouteOverlay } from '../components/SafeRouteOverlay'
import { ZapButton } from '../components/ZapButton'
import { VerificationBadges } from '../components/VerificationBadges'
import { ReportSubmit } from '../components/ReportSubmit'
import { ReportList } from '../components/ReportList'
import type { SafetyEvent } from '../../../../shared/types'

const selectActiveEvents = createSelector(
  (state: RootState) => state.events.items,
  items => items.filter(e => e.is_active)
)

type Panel = 'none' | 'submit' | 'list'

export function LiveMapPage() {
  const events = useAppSelector(selectActiveEvents)
  const connected = useAppSelector(state => state.events.connected)
  const [selected, setSelected] = useState<SafetyEvent | null>(null)
  const [panel, setPanel] = useState<Panel>('none')

  return (
    <div data-testid="live-map-page" style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 10,
        background: connected ? '#4CAF50' : '#FF2D2D',
        color: 'white', padding: '4px 10px', borderRadius: 12,
        fontSize: 12, fontFamily: 'sans-serif',
      }}>
        {connected ? `Live · ${events.length} events` : 'Reconnecting…'}
      </div>

      <MapCanvas>
        {events.map(event => (
          <Marker key={event.id} longitude={event.lng} latitude={event.lat} anchor="center">
            <EventMarker event={event} onClick={setSelected} />
          </Marker>
        ))}

        {selected && (
          <Popup
            longitude={selected.lng}
            latitude={selected.lat}
            onClose={() => setSelected(null)}
            closeButton={true}
            maxWidth="280px"
          >
            <div style={{ fontFamily: 'sans-serif', fontSize: 13 }}>
              <strong style={{ color: '#333' }}>{selected.title}</strong>
              {selected.summary && <p style={{ margin: '6px 0 0' }}>{selected.summary}</p>}
              <p style={{ margin: '6px 0 0', color: '#666', fontSize: 11 }}>
                {selected.place_name} · {selected.severity}
              </p>
              <ZapButton reportId={selected.id} />
              <VerificationBadges
                nostrEventId={selected.nostr_event_id}
                bitcoinTxid={selected.bitcoin_txid}
              />
            </div>
          </Popup>
        )}

        <SafeRouteOverlay routes={[]} />
      </MapCanvas>

      <div style={{ position: 'absolute', bottom: 24, right: 16, zIndex: 10, display: 'flex', gap: 8 }}>
        <button onClick={() => setPanel(p => p === 'list' ? 'none' : 'list')} style={fabStyle('#1565C0')}>
          Reports
        </button>
        <button onClick={() => setPanel(p => p === 'submit' ? 'none' : 'submit')} style={fabStyle('#2E7D32')}>
          + Report
        </button>
      </div>
      {panel === 'submit' && <div style={panelStyle}><ReportSubmit onClose={() => setPanel('none')} /></div>}
      {panel === 'list' && <div style={panelStyle}><ReportList /></div>}
    </div>
  )
}

function fabStyle(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#fff', border: 'none', borderRadius: 20,
    padding: '8px 18px', fontSize: 13, cursor: 'pointer',
    fontFamily: 'sans-serif', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  }
}

const panelStyle: React.CSSProperties = {
  position: 'absolute', bottom: 72, right: 16, zIndex: 10,
}
