import { useEffect, useRef } from 'react'
import { useDispatch } from 'react-redux'
import { eventReceived, eventResolved, setConnected } from '../store/eventsSlice'
import type { WsMessage, SafetyEvent } from '../../../../shared/types'

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws?county=global`

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
          dispatch(eventResolved(msg.payload as { event_id: string }))
        }
      } catch {
        console.warn('Invalid WebSocket message received')
      }
    }

    ws.onclose = () => {
      dispatch(setConnected(false))
      // Reconnect after 3 seconds
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
