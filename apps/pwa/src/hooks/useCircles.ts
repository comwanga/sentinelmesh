import { useEffect } from 'react'
import { useAppDispatch } from '../store'
import { circleLoaded } from '../store/circlesSlice'
import { signLocalNip98AuthEvent, sha256Hex } from '../services/nostrService'
import { getCircleIds } from '../services/circleIdStore'
import { loadCircleKey, decryptString, encryptString, unwrapNip44CircleKey } from '../services/e2eeService'
import { getCircleOwnerKey } from '../services/circleIdStore'
import type { Circle, CircleMember } from '../../../../shared/types'
import { useActiveIdentity } from './useActiveIdentity'

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
interface RawCircleDetail extends RawCircle {
  members: RawMember[]
  my_key_wrap?: { version: number; ciphertext: string } | null
}

async function toCircleAndMembers(
  detail: RawCircleDetail,
): Promise<{ circle: Circle; members: CircleMember[] }> {
  let key = await loadCircleKey(detail.id)
  if (!key && detail.my_key_wrap?.version === 2) {
    const ownerPubkey = getCircleOwnerKey(detail.id)
    if (!ownerPubkey) throw new Error('Circle owner key is unavailable')
    await unwrapNip44CircleKey(detail.id, ownerPubkey, detail.my_key_wrap.ciphertext)
    key = await loadCircleKey(detail.id)
  }

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
  const activeIdentity = useActiveIdentity()

  useEffect(() => {
    if (activeIdentity.mode !== 'local') return
    const controller = new AbortController()
    const requestSignal = () => AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
    async function load() {
      const headers = async (url: string, method: string, body?: string) => {
        const absoluteUrl = new URL(url, window.location.origin).toString()
        const hash = body === undefined ? undefined : await sha256Hex(body)
        return {
          'Content-Type': 'application/json',
          'X-Nostr-Auth': JSON.stringify(signLocalNip98AuthEvent(absoluteUrl, method, hash)),
        }
      }

      const ids = getCircleIds()
      if (ids.length === 0) return
      let circles: RawCircle[]
      try {
        const listUrl = `${API_BASE}/api/circles?ids=${ids.join(',')}`
        const res = await fetch(listUrl, { headers: await headers(listUrl, 'GET'), signal: requestSignal() })
        if (!res.ok) return
        circles = await res.json() as RawCircle[]
      } catch {
        return
      }

      for (const c of circles) {
        try {
          const detailUrl = `${API_BASE}/api/circles/${c.id}`
          const res = await fetch(detailUrl, { headers: await headers(detailUrl, 'GET'), signal: requestSignal() })
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
              const encryptionUrl = `${API_BASE}/api/circles/${detail.id}/encryption`
              const body = JSON.stringify({ name_ciphertext: nameCiphertext, member_labels: [] })
              await fetch(encryptionUrl, {
                method: 'PUT',
                headers: await headers(encryptionUrl, 'PUT', body),
                signal: requestSignal(),
                body,
              }).catch(() => { /* best-effort; retried on next load */ })
            }
          }

          if (!controller.signal.aborted) dispatch(circleLoaded({ circle, members }))
        } catch {
          // skip failed circles
        }
      }
    }

    load()
    return () => controller.abort()
  }, [dispatch, activeIdentity.mode])
}
