import { useNavigate } from 'react-router-dom'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { FamilyCircleDashboard } from '../components/FamilyCircleDashboard'
import { useActiveIdentity } from '../hooks/useActiveIdentity'

export function CirclesPage() {
  const { layout } = useBreakpoint()
  const navigate = useNavigate()
  const activeIdentity = useActiveIdentity()

  if (activeIdentity.mode === 'bunker') {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 24, background: '#0B0E14' }}>
        <div style={{ maxWidth: 520, border: '1px solid #2d1b00', borderRadius: 8, padding: 20, background: '#0d1118' }}>
          <h1 style={{ fontFamily: "'Courier New', monospace", fontSize: 15, color: '#FF8C00', margin: '0 0 10px' }}>Circles unavailable with remote signing</h1>
          <p style={{ fontFamily: "'Courier New', monospace", fontSize: 11, lineHeight: 1.6, color: '#94a3b8', margin: '0 0 14px' }}>
            Circles require this device's local NIP-44 key. Disconnect the remote signer in Settings to use circles without mixing identities.
          </p>
          <button onClick={() => navigate('/settings')} style={{ background: 'none', border: '1px solid #00E5FF', borderRadius: 4, color: '#00E5FF', fontFamily: "'Courier New', monospace", fontSize: 10, padding: '7px 12px', cursor: 'pointer' }}>
            OPEN SETTINGS
          </button>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="circles-page" style={{ height: '100%', overflow: 'auto', background: '#0B0E14', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        background: '#1B5E20', color: '#4CAF50',
        fontFamily: "'Courier New', monospace", fontSize: 10,
        padding: '4px 12px', textAlign: 'center', letterSpacing: '0.05em',
      }}>
        END-TO-END ENCRYPTED — ZERO KNOWLEDGE
      </div>

      {layout === 'mobile' && (
        <button
          onClick={() => navigate('/map')}
          style={{
            margin: '8px 12px', background: 'none', border: '1px solid #00E5FF',
            borderRadius: 4, color: '#00E5FF', fontFamily: "'Courier New', monospace",
            fontSize: 11, padding: '6px 12px', cursor: 'pointer',
          }}
        >
          VIEW ON MAP
        </button>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        <FamilyCircleDashboard />
      </div>
    </div>
  )
}
