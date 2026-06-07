import { useEffect } from 'react'
import { useAppDispatch } from '../store'
import { circleLoaded } from '../store/circlesSlice'
import { signAuthEvent } from '../services/nostrService'
import { getCircleIds } from '../services/circleIdStore'
import { loadCircleKey, decryptString, encryptString } from '../services/e2eeService'
import type { Circle, CircleMember } from '../../../../shared/types'

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? ''

interface RawCircle {
  id: string
  name?: string | null
  name_ciphertext?: string | null
  name_version?: number
  created_at: string
  is_owner?: boolean
}
interface RawMember {
  circle_id: string
  member_token: string
  member_label_ciphertext?: string | null
  alert_radius_km: number | null
  alert_severity: string | null
  joined_at: string
}
interface RawCircleDetail extends RawCircle { members: RawMember[] }

async function toCircleAndMembers(
  detail: RawCircleDetail,
): Promise<{ circle: Circle; members: CircleMember[] }> {
  const key = await loadCircleKey(detail.id)

  // Decrypt circle name
  let displayName: string | null | undefined
  if (detail.name_version === 1 && detail.name_ciphertext && key) {
    displayName = (await decryptString(key, detail.name_ciphertext)) ?? '(locked)'
  } else {
    displayName = detail.name ?? '(unnamed)'
  }

  const circle: Circle = {
    circle_id: detail.id,
    name: displayName,
    name_ciphertext: detail.name_ciphertext,
    name_version: detail.name_version,
    created_at: detail.created_at,
    is_owner: detail.is_owner ?? false,
  }

  // Decrypt each member's label
  const members: CircleMember[] = await Promise.all(
    detail.members.map(async (m): Promise<CircleMember> => {
      const member: CircleMember = {
        circle_id: m.circle_id,
        member_token: m.member_token,
        alert_radius_km: m.alert_radius_km ?? 5,
        alert_severity: (m.alert_severity ?? 'MEDIUM') as CircleMember['alert_severity'],
        joined_at: m.joined_at,
        member_label_ciphertext: m.member_label_ciphertext,
      }

      if (key && m.member_label_ciphertext) {
        const decoded = await decryptString(key, m.member_label_ciphertext)
        if (decoded) {
          try {
            const { pubkey, name } = JSON.parse(decoded) as { pubkey: string; name: string }
            member.pubkey = pubkey
            member.label = name
          } catch {
            // leave undefined — renders as "unknown member"
          }
        }
      }

      return member
    }),
  )

  return { circle, members }
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

      const ids = getCircleIds()
      if (ids.length === 0) return
      let circles: RawCircle[]
      try {
        const res = await fetch(`${API_BASE}/api/circles?ids=${ids.join(',')}`, { headers, signal: AbortSignal.timeout(15_000) })
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
          const { circle, members } = await toCircleAndMembers(detail)

          // Lazy-migrate legacy plaintext names to ciphertext (owner only,
          // name_version === 0 means pre-Phase-B plaintext). Best-effort:
          // a failed PUT does not block the store dispatch and retries on
          // next load once name_version is still 0.
          if (detail.is_owner && detail.name_version === 0 && detail.name) {
            const migKey = await loadCircleKey(detail.id)
            if (migKey) {
              const nameCiphertext = await encryptString(migKey, detail.name)
              // Names migrate now; member labels are NOT auto-migrated (the owner
              // cannot reverse a member_token to a pubkey) — they fill in as members
              // are (re-)added via add_member. Send an empty member_labels list.
              await fetch(`${API_BASE}/api/circles/${detail.id}/encryption`, {
                method: 'PUT',
                headers,
                signal: AbortSignal.timeout(15_000),
                body: JSON.stringify({ name_ciphertext: nameCiphertext, member_labels: [] }),
              }).catch(() => { /* best-effort; retried on next load */ })
            }
          }

          dispatch(circleLoaded({ circle, members }))
        } catch {
          // skip failed circles
        }
      }
    }

    load()
  }, [dispatch])
}
