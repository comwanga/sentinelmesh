import { useEffect, useRef } from 'react'
import { useDispatch } from 'react-redux'
import { eventReceived, eventResolved, setConnected } from '../store/eventsSlice'
import { reportReceived } from '../store/reportSlice'
import type { WsMessage, SafetyEvent, CommunityReport } from '../../../../shared/types'

// In dev, connect directly to the gateway to avoid Vite WS proxy issues on Windows.
// In production, the PWA and gateway share the same origin behind nginx.
const WS_HOST = import.meta.env.DEV ? 'localhost:3000' : window.location.host
const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${WS_HOST}/ws?county=global`

export function useWsConnection(): void {
  const dispatch = useDispatch()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function connect(): void {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      dispatch(setConnected(true))
      console.log('WebSocket connected')
    }

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data)
        if (msg.type === 'NEW_EVENT' || msg.type === 'EVENT_UPDATED') {
          dispatch(eventReceived(msg.payload as SafetyEvent))
        } else if (msg.type === 'EVENT_RESOLVED') {
          dispatch(eventResolved(msg.payload as { id: string }))
        } else if (msg.type === 'NEW_REPORT' || msg.type === 'REPORT_UPDATED') {
          dispatch(reportReceived(msg.payload as CommunityReport))
        }
      } catch {
        console.warn('Invalid WebSocket message received')
      }
    }

    ws.onclose = () => {
      dispatch(setConnected(false))
      reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => ws.close()
  }

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [])
}
