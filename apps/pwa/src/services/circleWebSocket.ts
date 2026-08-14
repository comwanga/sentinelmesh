import { useEffect, useRef } from 'react'
import { useAppDispatch, useAppSelector } from '../store'
import { safeCircleLocationEnabled } from '../config/features'
import {
  locationReceived,
  circleEpochChanged,
  memberRemoved,
  circleLeft,
  circleDecryptError,
} from '../store/circlesSlice'
import { loadCircleKey, decryptCircleLocationV1 } from './e2eeService'
import { signEventAsync } from './nostrService'
import type { CircleLocationEnvelopeV1, CircleWsMessage } from '../../../../shared/types'

const WS_PATH = '/ws/circles'

interface Roster {
  pubkeys: Set<string>
  epoch: number
  selfToken?: string
}

interface LastSeen {
  event_id: string
  captured_at: number
}

export function useCircleWsConnection(circleId: string | null): void {
  const dispatch = useAppDispatch()
  const members = useAppSelector(s => (circleId ? (s.circles.members[circleId] ?? []) : []))
  const epoch = useAppSelector(s => {
    if (!circleId) return 1
    const c = s.circles.circles.find(x => x.circle_id === circleId)
    return s.circles.epochs[circleId]?.key_epoch ?? c?.key_epoch ?? 1
  })
  const selfToken = useAppSelector(s => {
    if (!circleId) return undefined
    return s.circles.circles.find(x => x.circle_id === circleId)?.self_token
  })

  const rosterRef = useRef<Roster>({ pubkeys: new Set(), epoch: 1 })
  rosterRef.current = {
    pubkeys: new Set(
      members
        .filter(m => m.pubkey && m.membership_state !== 'PENDING')
        .map(m => m.pubkey!.toLowerCase()),
    ),
    epoch,
    selfToken,
  }
  const seenRef = useRef<Map<string, LastSeen>>(new Map())
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    // Location transport stays dark unless the dedicated build-time gate is on.
    if (!circleId || !safeCircleLocationEnabled) return

    let closed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    async function handleEnvelope(env: CircleLocationEnvelopeV1): Promise<void> {
      const { pubkeys, epoch: currentEpoch } = rosterRef.current
      if (env.key_epoch !== currentEpoch) return

      const key = await loadCircleKey(env.circle_id, env.key_epoch)
      if (!key) {
        dispatch(circleDecryptError('circle key unavailable'))
        return
      }
      const now = Math.floor(Date.now() / 1000)
      const loc = await decryptCircleLocationV1(
        key, env.ciphertext, env.circle_id, env.key_epoch, pubkeys, now,
      )
      if (!loc) return // unknown/pending/removed/stale/malformed signer
      const pubkey = loc.pubkey.toLowerCase()
      const last = seenRef.current.get(pubkey)
      if (last && (last.event_id === loc.event_id || loc.captured_at < last.captured_at)) {
        return // duplicate or older
      }
      seenRef.current.set(pubkey, { event_id: loc.event_id, captured_at: loc.captured_at })
      dispatch(locationReceived({
        pubkey,
        lat: loc.lat,
        lng: loc.lng,
        ts: new Date(loc.captured_at * 1000).toISOString(),
        event_id: loc.event_id,
        expires_at: loc.expires_at,
        accuracy_m: loc.accuracy_m,
        precision: loc.precision,
      }))
    }

    async function connect(): Promise<void> {
      if (closed || !circleId) return
      const url = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`
      let auth: Record<string, unknown>
      try {
        auth = await signEventAsync({
          kind: 27235,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['u', url],
            ['method', 'GET'],
            ['circle', circleId],
            ['nonce', crypto.randomUUID()],
          ],
          content: '',
        }) as unknown as Record<string, unknown>
      } catch {
        return
      }
      if (closed) return

      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join_circle', circle_id: circleId, nostr_auth_event: auth }))
      }

      ws.onmessage = (event) => {
        let msg: CircleWsMessage
        try {
          msg = JSON.parse(event.data as string) as CircleWsMessage
        } catch {
          return
        }
        switch (msg.type) {
          case 'CIRCLE_LOCATION_SNAPSHOT':
            for (const env of msg.payload) void handleEnvelope(env)
            break
          case 'CIRCLE_LOCATION_ENVELOPE':
            void handleEnvelope(msg.payload)
            break
          case 'CIRCLE_EPOCH_CHANGED':
            dispatch(circleEpochChanged(msg.payload))
            break
          case 'CIRCLE_MEMBER_REMOVED': {
            if (msg.payload.token === rosterRef.current.selfToken) {
              dispatch(circleLeft())
              ws.close(4003, 'removed from circle')
              return
            }
            dispatch(memberRemoved({ circle_id: msg.payload.circle_id, token: msg.payload.token }))
            break
          }
        }
      }

      ws.onclose = (event) => {
        if (closed) return
        // Forbidden/removed: never reconnect.
        if (event.code === 4001 || event.code === 4003) return
        attempt += 1
        const base = 1000 * 2 ** Math.min(attempt, 5)
        const delay = Math.min(base, 30_000) + Math.floor(Math.random() * 1000)
        timer = setTimeout(() => { void connect() }, delay)
      }
      ws.onerror = () => ws.close()
    }

    void connect()

    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [circleId, dispatch])
}
