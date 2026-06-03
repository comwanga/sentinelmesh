import { useEffect, useRef } from 'react'
import { useAppDispatch } from '../store'
import { memberStatusUpdated, locationReceived, circleDecryptError } from '../store/circlesSlice'
import { decryptLocation, loadCircleKey } from './e2eeService'
import type { CircleWsMessage } from '../../../../shared/types'

const WS_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/circles`

export function useCircleWsConnection(circleId: string | null, nostrAuthEvent?: Record<string, unknown>): void {
  const dispatch = useAppDispatch()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!circleId) return

    function connect(): void {
      const ws = new WebSocket(WS_BASE)
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'join_circle',
          circle_id: circleId,
          ...(nostrAuthEvent ? { nostr_auth_event: nostrAuthEvent } : {}),
        }))
      }

      ws.onmessage = async (event) => {
        try {
          const msg: CircleWsMessage = JSON.parse(event.data as string)

          if (msg.type === 'CIRCLE_LOCATION_BLOB') {
            const { sender_pubkey, encrypted_payload, sent_at } = msg.payload
            const key = await loadCircleKey(circleId!)
            if (!key) {
              dispatch(circleDecryptError(`${sender_pubkey.slice(0, 8)}… — circle key not found`))
              return
            }
            const loc = await decryptLocation(key, encrypted_payload)
            if (loc) {
              dispatch(locationReceived({ pubkey: sender_pubkey, lat: loc.lat, lng: loc.lng, ts: sent_at }))
            } else {
              dispatch(circleDecryptError(`${sender_pubkey.slice(0, 8)}… — decryption failed`))
            }
          } else if (msg.type === 'CIRCLE_PRESENCE') {
            dispatch(memberStatusUpdated({ pubkey: msg.payload.sender_pubkey, status: msg.payload.mode }))
          }
        } catch {
          console.warn('[circle-ws] invalid message')
        }
      }

      ws.onclose = (event) => {
        if (event.code === 1000) return
        reconnectTimer.current = setTimeout(connect, 3000)
      }

      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      wsRef.current?.close()
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [circleId, dispatch, nostrAuthEvent])
}
