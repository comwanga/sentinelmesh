import { useEffect, useRef } from 'react'
import { useDispatch } from 'react-redux'
import { eventReceived, eventResolved, setConnected } from '../store/eventsSlice'
import { reportReceived } from '../store/reportSlice'
import type { WsMessage } from '../../../../shared/types'

// In dev, connect directly to the gateway to avoid Vite WS proxy issues on Windows.
// In production, the PWA and gateway share the same origin behind nginx.
const WS_HOST = import.meta.env.DEV ? 'localhost:3000' : window.location.host
const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${WS_HOST}/ws?county=global`

const BACKOFF_BASE_MS = 1000
const BACKOFF_CAP_MS = 30_000
const BACKOFF_JITTER = 0.2

function backoffDelay(attempt: number): number {
  const exp = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_CAP_MS)
  // add ±20% jitter to spread reconnect storms
  const jitter = exp * BACKOFF_JITTER * (Math.random() * 2 - 1)
  return Math.round(exp + jitter)
}

export function useWsConnection(): void {
  const dispatch = useDispatch()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCount = useRef<number>(0)

  function connect(): void {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      retryCount.current = 0
      dispatch(setConnected(true))
      console.log('WebSocket connected')
    }

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data)
        if (msg.type === 'NEW_EVENT' || msg.type === 'EVENT_UPDATED') {
          dispatch(eventReceived(msg.payload))
        } else if (msg.type === 'EVENT_RESOLVED') {
          dispatch(eventResolved(msg.payload))
        } else if (msg.type === 'NEW_REPORT' || msg.type === 'REPORT_UPDATED') {
          dispatch(reportReceived(msg.payload))
        }
      } catch {
        console.warn('Invalid WebSocket message received')
      }
    }

    ws.onclose = (event) => {
      dispatch(setConnected(false))
      if (event.code === 1000) {
        // clean close, reset retry counter and do not reconnect
        retryCount.current = 0
        return
      }
      const delay = backoffDelay(retryCount.current)
      retryCount.current += 1
      console.log(`WebSocket closed (code ${event.code}), reconnecting in ${delay}ms (attempt ${retryCount.current})`)
      reconnectTimer.current = setTimeout(connect, delay)
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
