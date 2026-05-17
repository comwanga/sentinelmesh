import { useCallback, useState } from 'react'
import { useAppSelector, useAppDispatch } from '../store'
import { activeAlertDismissed, circleLeft, circleLoaded } from '../store/circlesSlice'
import { loadOrCreateKeypair, signAuthEvent } from '../services/nostrService'
import { CircleSidebar } from './CircleSidebar'
import { CircleMapLayer } from './CircleMapLayer'
import { AlertBanner } from './AlertBanner'
import { ProximityAlertLog } from './ProximityAlertLog'
import { InviteModal } from './InviteModal'
import { X25519Badge } from './X25519Badge'
import { MapCanvas } from './map/MapCanvas'
import { useCircleWsConnection } from '../services/circleWebSocket'
import { useProximityAlerts } from '../hooks/useProximityAlerts'
import { useBreakpoint } from '../hooks/useBreakpoint'
import type { Circle, CircleMember } from '../../../../shared/types'

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? ''

const EMPTY_MEMBERS: never[] = []

interface RawCircle { id: string; owner_pubkey: string; name: string; created_at: string }
interface RawMember { circle_id: string; member_pubkey: string; alert_radius_km: number | null; alert_severity: string | null; joined_at: string }

function toCircle(raw: RawCircle): Circle {
  return { circle_id: raw.id, owner_pubkey: raw.owner_pubkey, name: raw.name, created_at: raw.created_at }
}

function toMember(raw: RawMember): CircleMember {
  return {
    circle_id: raw.circle_id,
    member_pubkey: raw.member_pubkey,
    alert_radius_km: raw.alert_radius_km ?? 5,
    alert_severity: (raw.alert_severity ?? 'MEDIUM') as CircleMember['alert_severity'],
    joined_at: raw.joined_at,
  }
}

function EmptyState() {
  const dispatch = useAppDispatch()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setCreating(true)
    setError(null)
    try {
      const keypair = loadOrCreateKeypair()
      const authEvent = signAuthEvent(keypair.secretKey)
      const headers = {
        'Content-Type': 'application/json',
        'X-Nostr-Auth': JSON.stringify(authEvent),
      }
      const res = await fetch(`${API_BASE}/api/circles`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: trimmed }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) {
        setError(`Failed (${res.status}) — check your connection and try again`)
        return
      }
      const raw = await res.json() as RawCircle
      const circle = toCircle(raw)

      const detailRes = await fetch(`${API_BASE}/api/circles/${raw.id}`, { headers, signal: AbortSignal.timeout(15_000) })
      let members: CircleMember[] = []
      if (detailRes.ok) {
        const detail = await detailRes.json() as RawCircle & { members: RawMember[] }
        members = detail.members.map(toMember)
      }

      dispatch(circleLoaded({ circle, members }))
    } catch {
      setError('Network error — please try again')
    } finally {
      setCreating(false)
    }
  }, [name, dispatch])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', padding: 24, gap: 16,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%', border: '2px solid #00E5FF',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
      }}>
        ⬡
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 13, color: '#e2e8f0', fontWeight: 700, marginBottom: 4 }}>
          No Active Circle
        </div>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#4a5568' }}>
          Create a circle to share your location with trusted contacts
        </div>
      </div>

      <div style={{
        width: '100%', maxWidth: 320,
        background: '#0d1118', border: '1px solid #1a2035', borderRadius: 8, padding: 16,
      }}>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', marginBottom: 6, letterSpacing: '0.06em' }}>
          CIRCLE NAME
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: error ? 8 : 0 }}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            placeholder="e.g. Family"
            style={{
              flex: 1, background: '#0B0E14', border: '1px solid #1a2035', borderRadius: 4,
              color: '#e2e8f0', fontFamily: "'Courier New', monospace", fontSize: 12,
              padding: '7px 10px', outline: 'none',
            }}
          />
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            style={{
              background: creating || !name.trim() ? '#1a2035' : '#1B5E20',
              border: '1px solid ' + (creating || !name.trim() ? '#1a2035' : '#4CAF50'),
              borderRadius: 4, color: creating || !name.trim() ? '#4a5568' : '#4CAF50',
              fontFamily: "'Courier New', monospace", fontSize: 11,
              padding: '7px 14px', cursor: creating || !name.trim() ? 'default' : 'pointer',
              letterSpacing: '0.05em',
            }}
          >
            {creating ? '…' : 'Create'}
          </button>
        </div>
        {error && (
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#FF2D2D', marginTop: 4 }}>
            {error}
          </div>
        )}
      </div>

      <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#4a5568', textAlign: 'center', maxWidth: 260 }}>
        ✓ End-to-end encrypted · Zero knowledge · No server stores your location
      </div>
    </div>
  )
}

export function FamilyCircleDashboard() {
  const dispatch = useAppDispatch()
  const { layout } = useBreakpoint()
  const activeCircleId = useAppSelector(s => s.circles.activeCircleId)
  const circles = useAppSelector(s => s.circles.circles)
  const members = useAppSelector(s => { const id = s.circles.activeCircleId; return id ? (s.circles.members[id] ?? EMPTY_MEMBERS) : EMPTY_MEMBERS })
  const memberStatuses = useAppSelector(s => s.circles.memberStatuses)
  const decryptedLocations = useAppSelector(s => s.circles.decryptedLocations)
  const proximityAlerts = useAppSelector(s => s.circles.proximityAlerts)
  const activeAlert = useAppSelector(s => s.circles.activeAlert)
  const decryptErrors = useAppSelector(s => s.circles.decryptErrors)

  const activeCircle = circles.find(c => c.circle_id === activeCircleId) ?? null
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteString, setInviteString] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useCircleWsConnection(activeCircleId)
  useProximityAlerts()

  const handleInvite = useCallback(() => {
    setInviteString(`sentinelmesh:invite:${activeCircleId}:${Date.now()}`)
    setInviteOpen(true)
  }, [activeCircleId])

  const handleLeave = useCallback(() => {
    if (window.confirm('Leave this circle? Your local circle key will be removed.')) {
      dispatch(circleLeft())
    }
  }, [dispatch])

  const handleDismissAlert = useCallback(() => dispatch(activeAlertDismissed()), [dispatch])

  if (!activeCircle) {
    return <EmptyState />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0B0E14' }}>
      <AlertBanner alert={activeAlert} onDismiss={handleDismissAlert} />
      {decryptErrors.length > 0 && (
        <div style={{ background: '#2d1b00', color: '#FF8C00', fontFamily: "'Courier New', monospace", fontSize: 10, padding: '4px 12px' }}>
          Could not decrypt location for: {decryptErrors.join(' · ')} — check your circle key.
        </div>
      )}

      {/* Mobile: toggle sidebar button */}
      {layout === 'mobile' && (
        <button
          onClick={() => setSidebarOpen(o => !o)}
          style={{
            margin: '8px 12px', background: 'none', border: '1px solid #1a2035',
            borderRadius: 4, color: '#94a3b8', fontFamily: "'Courier New', monospace",
            fontSize: 11, padding: '6px 12px', cursor: 'pointer', textAlign: 'left',
          }}
        >
          {sidebarOpen ? '▲ Hide members' : '▼ Members · ' + members.length}
        </button>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: layout === 'mobile' ? 'column' : 'row' }}>
        {/* Sidebar — always visible on desktop, toggled on mobile */}
        {(layout === 'desktop' || sidebarOpen) && (
          <CircleSidebar
            circle={activeCircle}
            members={members}
            memberStatuses={memberStatuses}
            onInvite={handleInvite}
            onLeave={handleLeave}
          />
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: layout === 'mobile' ? 300 : undefined }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <MapCanvas initialViewState={{ longitude: 36.8219, latitude: -1.2921, zoom: 12 }}>
              <CircleMapLayer decryptedLocations={decryptedLocations} memberStatuses={memberStatuses} />
            </MapCanvas>
            <X25519Badge />
          </div>

          <ProximityAlertLog alerts={proximityAlerts} />
        </div>
      </div>

      <InviteModal isOpen={inviteOpen} inviteString={inviteString} onClose={() => setInviteOpen(false)} />
    </div>
  )
}
