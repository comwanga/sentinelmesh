import { useCallback, useState } from 'react'
import Map from 'react-map-gl'
import { useAppSelector, useAppDispatch } from '../store'
import { activeAlertDismissed } from '../store/circlesSlice'
import { CircleSidebar } from './CircleSidebar'
import { CircleMapLayer } from './CircleMapLayer'
import { AlertBanner } from './AlertBanner'
import { ProximityAlertLog } from './ProximityAlertLog'
import { InviteModal } from './InviteModal'
import { X25519Badge } from './X25519Badge'
import { useCircleWsConnection } from '../services/circleWebSocket'
import { useProximityAlerts } from '../hooks/useProximityAlerts'
import 'mapbox-gl/dist/mapbox-gl.css'

const MAPBOX_TOKEN = import.meta.env['VITE_MAPBOX_TOKEN'] as string

export function FamilyCircleDashboard() {
  const dispatch = useAppDispatch()
  const activeCircleId = useAppSelector(s => s.circles.activeCircleId)
  const circles = useAppSelector(s => s.circles.circles)
  const members = useAppSelector(s => activeCircleId ? (s.circles.members[activeCircleId] ?? []) : [])
  const memberStatuses = useAppSelector(s => s.circles.memberStatuses)
  const decryptedLocations = useAppSelector(s => s.circles.decryptedLocations)
  const proximityAlerts = useAppSelector(s => s.circles.proximityAlerts)
  const activeAlert = useAppSelector(s => s.circles.activeAlert)

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
      dispatch({ type: 'circles/circleLeft' })
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
            <Map
              mapboxAccessToken={MAPBOX_TOKEN}
              initialViewState={{ longitude: 36.8219, latitude: -1.2921, zoom: 12 }}
              style={{ width: '100%', height: '100%' }}
              mapStyle="mapbox://styles/mapbox/dark-v11"
            >
              <CircleMapLayer decryptedLocations={decryptedLocations} memberStatuses={memberStatuses} />
            </Map>
            <X25519Badge />
          </div>

          <ProximityAlertLog alerts={proximityAlerts} />
        </div>
      </div>

      <InviteModal isOpen={inviteOpen} inviteString={inviteString} onClose={() => setInviteOpen(false)} />
    </div>
  )
}
