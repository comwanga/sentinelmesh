import { useEffect, useRef } from 'react'
import { useDispatch } from 'react-redux'
import { eventReceived, eventResolved, setConnected } from '../store/eventsSlice'
import { reportReceived } from '../store/reportSlice'
import { parseEvent, parseReport } from './safetyDataApi'
import { websocketBaseUrl } from './apiOrigin'

const WS_URL = `${websocketBaseUrl()}/ws?county=global`

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
        const msg: { type?: string; payload?: unknown } = JSON.parse(event.data)
        if (msg.type === 'NEW_EVENT' || msg.type === 'EVENT_UPDATED') {
          const payload = parseEvent(msg.payload)
          if (payload) dispatch(eventReceived(payload))
        } else if (msg.type === 'EVENT_RESOLVED' && typeof (msg.payload as { id?: unknown })?.id === 'string') {
          dispatch(eventResolved({ id: (msg.payload as { id: string }).id }))
        } else if (msg.type === 'NEW_REPORT' || msg.type === 'REPORT_UPDATED') {
          const payload = parseReport(msg.payload)
          if (payload) dispatch(reportReceived(payload))
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
