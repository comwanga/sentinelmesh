import { useEffect } from 'react'
import { useAppDispatch } from '../store'
import { circleLoaded } from '../store/circlesSlice'
import { signAuthEvent } from '../services/nostrService'
import type { Circle, CircleMember } from '../../../../shared/types'

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? ''

interface RawCircle { id: string; owner_pubkey: string; name: string; created_at: string }
interface RawMember { circle_id: string; member_pubkey: string; alert_radius_km: number | null; alert_severity: string | null; joined_at: string }
interface RawCircleDetail extends RawCircle { members: RawMember[] }

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

export function useCircles(): void {
  const dispatch = useAppDispatch()

  useEffect(() => {
    async function load() {
      const authEvent = await signAuthEvent()
      const headers = {
        'Content-Type': 'application/json',
        'X-Nostr-Auth': JSON.stringify(authEvent),
      }

      let circles: RawCircle[]
      try {
        const res = await fetch(`${API_BASE}/api/circles`, { headers, signal: AbortSignal.timeout(15_000) })
        if (!res.ok) return
        circles = await res.json() as RawCircle[]
      } catch {
        return
      }

      for (const c of circles) {
        try {
          const res = await fetch(`${API_BASE}/api/circles/${c.id}`, { headers, signal: AbortSignal.timeout(15_000) })
          if (!res.ok) continue
          const detail = await res.json() as RawCircleDetail
          dispatch(circleLoaded({ circle: toCircle(detail), members: detail.members.map(toMember) }))
        } catch {
          // skip failed circles
        }
      }
    }

    load()
  }, [dispatch])
}
