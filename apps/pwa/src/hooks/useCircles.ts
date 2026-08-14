import { useEffect } from 'react'
import { useAppDispatch } from '../store'
import { circleLoaded, circleEpochChanged } from '../store/circlesSlice'
import { signLocalNip98AuthEvent, sha256Hex } from '../services/nostrService'
import { getCircleIds } from '../services/circleIdStore'
import { loadCircleKey, decryptString, encryptString, unwrapNip44CircleKey, unwrapLegacyCircleKey } from '../services/e2eeService'
import { getCircleOwnerKey } from '../services/circleIdStore'
import type { Circle, CircleMember } from '../../../../shared/types'
import { useActiveIdentity } from './useActiveIdentity'

const API_BASE = import.meta.env['VITE_API_BASE_URL'] ?? ''

interface RawCircle {
  id: string
  name?: string | null
  name_ciphertext?: string | null
  name_version?: number
  key_epoch?: number
  location_protocol_version?: number
  rekey_required?: boolean
  membership_revision?: number
  self_token?: string
  created_at: string
  is_owner?: boolean
}
interface RawMember {
  circle_id: string
  member_token?: string | null
  member_label_ciphertext?: string | null
  alert_radius_km: number | null
  alert_severity: string | null
  membership_state?: 'PENDING' | 'ACTIVE'
  accepted_at?: string | null
  key_wrap_epoch?: number | null
  joined_at: string
}
interface RawCircleDetail extends RawCircle {
  members: RawMember[]
  my_key_wrap?: { version?: number | null; epoch?: number | null; event?: unknown; ciphertext?: string | null } | null
}

async function toCircleAndMembers(
  detail: RawCircleDetail,
): Promise<{ circle: Circle; members: CircleMember[] }> {
  const keyEpoch = detail.key_epoch ?? 1
  let key = await loadCircleKey(detail.id, keyEpoch)
  if (!key && detail.my_key_wrap) {
    const ownerPubkey = getCircleOwnerKey(detail.id)
    if (ownerPubkey) {
      try {
        if (detail.my_key_wrap.version === 2 && detail.my_key_wrap.event) {
          await unwrapNip44CircleKey(detail.id, ownerPubkey, detail.my_key_wrap.event as never)
        } else if (detail.my_key_wrap.ciphertext) {
          await unwrapLegacyCircleKey(detail.id, ownerPubkey, detail.my_key_wrap.ciphertext)
        }
      } catch {
        // leave key null — renders as locked
      }
      key = await loadCircleKey(detail.id, keyEpoch)
    }
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
    key_epoch: detail.key_epoch ?? 1,
    location_protocol_version: detail.location_protocol_version,
    rekey_required: detail.rekey_required,
    membership_revision: detail.membership_revision,
    self_token: detail.self_token,
    created_at: detail.created_at,
    is_owner: detail.is_owner ?? false,
  }

  // Decrypt each member's label
  const members: CircleMember[] = await Promise.all(
    detail.members.map(async (m): Promise<CircleMember> => {
      const member: CircleMember = {
        circle_id: m.circle_id,
        member_token: m.member_token ?? null,
        alert_radius_km: m.alert_radius_km ?? 5,
        alert_severity: (m.alert_severity ?? 'MEDIUM') as CircleMember['alert_severity'],
        joined_at: m.joined_at,
        member_label_ciphertext: m.member_label_ciphertext,
        membership_state: m.membership_state ?? 'ACTIVE',
        accepted_at: m.accepted_at ?? null,
        key_wrap_epoch: m.key_wrap_epoch ?? null,
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
            const migKey = await loadCircleKey(detail.id, circle.key_epoch ?? 1)
            if (migKey) {
              const nameCiphertext = await encryptString(migKey, detail.name)
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

          if (!controller.signal.aborted) {
            dispatch(circleLoaded({ circle, members }))
            dispatch(circleEpochChanged({ circle_id: circle.circle_id, key_epoch: circle.key_epoch ?? 1, rekey_required: circle.rekey_required ?? true }))
          }
        } catch {
          // skip failed circles
        }
      }
    }

    load()
    return () => controller.abort()
  }, [dispatch, activeIdentity.mode])
}
