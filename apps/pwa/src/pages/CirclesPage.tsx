import { useNavigate } from 'react-router-dom'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { FamilyCircleDashboard } from '../components/FamilyCircleDashboard'

export function CirclesPage() {
  const { layout } = useBreakpoint()
  const navigate = useNavigate()

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
