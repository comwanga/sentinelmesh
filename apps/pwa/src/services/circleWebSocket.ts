import { useEffect, useRef } from 'react'
import { useAppDispatch } from '../store'
import { safeCircleLocationEnabled } from '../config/features'
import type { CircleWsMessage } from '../../../../shared/types'

const WS_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/circles`

export function useCircleWsConnection(circleId: string | null, nostrAuthEvent?: Record<string, unknown>): void {
  const dispatch = useAppDispatch()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // The WS authentication/snapshot protocol is not yet repaired. Do not open
    // or render location traffic merely because experimental circles are on.
    if (!circleId || !safeCircleLocationEnabled) return

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

          // Future opaque snapshot/envelope/epoch/removal messages are parsed but
          // intentionally not rendered until member-to-envelope binding is safe.
          void msg
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
