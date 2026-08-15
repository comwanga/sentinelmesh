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
      <div className="feature-notice">
        <div>
          <h1 style={{ fontFamily: "'Courier New', monospace", fontSize: 15, color: '#FF8C00', margin: '0 0 10px' }}>Circles unavailable with remote signing</h1>
          <p style={{ fontFamily: "'Courier New', monospace", fontSize: 11, lineHeight: 1.6, color: '#94a3b8', margin: '0 0 14px' }}>
            Circles require this device's local NIP-44 key. Disconnect the remote signer in Settings to use circles without mixing identities.
          </p>
          <button onClick={() => navigate('/settings')} className="button-primary">
            Open settings
          </button>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="circles-page" className="bright-feature circles-page">
      <div className="feature-banner">
        Encrypted family circles
      </div>

      {layout === 'mobile' && (
        <button
          onClick={() => navigate('/map')}
          className="button-secondary feature-map-button"
        >
          View safety map
        </button>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        <FamilyCircleDashboard />
      </div>
    </div>
  )
}
