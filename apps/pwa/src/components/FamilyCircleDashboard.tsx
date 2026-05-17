import { useCallback, useState } from 'react'
import { useAppSelector, useAppDispatch } from '../store'
import { activeAlertDismissed, circleLeft } from '../store/circlesSlice'
import { CircleSidebar } from './CircleSidebar'
import { CircleMapLayer } from './CircleMapLayer'
import { AlertBanner } from './AlertBanner'
import { ProximityAlertLog } from './ProximityAlertLog'
import { InviteModal } from './InviteModal'
import { X25519Badge } from './X25519Badge'
import { MapCanvas } from './map/MapCanvas'
import { useCircleWsConnection } from '../services/circleWebSocket'
import { useProximityAlerts } from '../hooks/useProximityAlerts'

const EMPTY_MEMBERS: never[] = []

export function FamilyCircleDashboard() {
  const dispatch = useAppDispatch()
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
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#4a5568', fontFamily: "'Courier New', monospace", fontSize: 12 }}>
        No active circle — create or join a circle to begin.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0B0E14' }}>
      <AlertBanner alert={activeAlert} onDismiss={handleDismissAlert} />
      {decryptErrors.length > 0 && (
        <div style={{ background: '#2d1b00', color: '#FF8C00', fontFamily: "'Courier New', monospace", fontSize: 10, padding: '4px 12px' }}>
          Could not decrypt location for: {decryptErrors.join(' · ')} — check your circle key.
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <CircleSidebar
          circle={activeCircle}
          members={members}
          memberStatuses={memberStatuses}
          onInvite={handleInvite}
          onLeave={handleLeave}
        />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
