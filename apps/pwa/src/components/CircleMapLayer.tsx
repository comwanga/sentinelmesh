import { Marker } from 'react-map-gl/maplibre'
import type { CircleMember, MemberStatus } from '../../../../shared/types'

interface DecryptedLocation {
  lat: number
  lng: number
  ts: string
  accuracy_m?: number
  precision?: 'exact' | 'approximate'
}

interface CircleMapLayerProps {
  decryptedLocations: Record<string, DecryptedLocation>
  memberStatuses: Record<string, MemberStatus>
  members?: CircleMember[]
  myPubkey?: string
}

function ageLabel(ts: string): { text: string; stale: boolean } {
  const diffMs = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return { text: 'just now', stale: false }
  if (mins < 5) return { text: `${mins}m ago`, stale: false }
  return { text: `${mins}m ago`, stale: true }
}

export function CircleMapLayer({ decryptedLocations, memberStatuses, members = [], myPubkey }: CircleMapLayerProps) {
  // Resolve a human roster label; never render raw pubkeys.
  const labelFor = (pubkey: string): string => {
    const normalized = pubkey.toLowerCase()
    if (myPubkey && normalized === myPubkey.toLowerCase()) return 'You'
    const member = members.find(m => m.pubkey && m.pubkey.toLowerCase() === normalized)
    if (member?.label) return member.label
    return 'Member'
  }

  return (
    <>
      {Object.entries(decryptedLocations).map(([pubkey, loc]) => {
        if (memberStatuses[pubkey] !== 'ONLINE') return null
        const label = labelFor(pubkey)
        const { text: age, stale } = ageLabel(loc.ts)
        const approximate = loc.precision === 'approximate'
        return (
          <Marker key={pubkey} latitude={loc.lat} longitude={loc.lng}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%',
                border: '2px solid #00E5FF',
                boxShadow: '0 0 12px rgba(0,229,255,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00E5FF' }} />
                <div style={{
                  position: 'absolute', inset: -4, borderRadius: '50%',
                  border: '1px solid rgba(0,229,255,0.2)',
                  animation: 'node-ping 1.8s ease-out infinite',
                }} />
              </div>
              <span style={{
                fontFamily: "'Courier New', monospace", fontSize: 9, color: '#a0aec0',
                background: 'rgba(13,17,24,0.8)', padding: '1px 4px', borderRadius: 3,
                whiteSpace: 'nowrap',
              }}>
                {label}{approximate ? ' ≈' : ''}
              </span>
              <span style={{
                fontFamily: "'Courier New', monospace", fontSize: 8,
                color: stale ? '#FF8C00' : '#4a5568',
                background: 'rgba(13,17,24,0.8)', padding: '1px 4px', borderRadius: 3,
                whiteSpace: 'nowrap',
              }}>
                {age}
              </span>
            </div>
          </Marker>
        )
      })}
      <style>{`
        @keyframes node-ping {
          0%   { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.8); }
        }
      `}</style>
    </>
  )
}
