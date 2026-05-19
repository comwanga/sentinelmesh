import { useEffect, useRef } from 'react'
import { useAppDispatch } from '../store'
import { viewportEventsSet, viewportEventsBatchApply } from '../store/viewportEventsSlice'
import type { SafetyEvent, EventType, EventState, Severity } from '../../../../shared/types'

export interface ViewportBounds {
  north: number
  south: number
  east: number
  west: number
}

interface WsEvent {
  id: string
  event_type: string
  severity: string
  state: string
  title: string
  lat: number
  lng: number
  started_at: string
}

type ViewportServerMsg =
  | { type: 'INITIAL_BATCH'; payload: { events: WsEvent[] } }
  | { type: 'SNAPSHOT';      payload: { events: WsEvent[] } }
  | { type: 'DIFF_PATCH';    payload: { added: WsEvent[]; removed: string[]; updated: WsEvent[] } }

const WS_HOST = import.meta.env.DEV ? 'localhost:3000' : window.location.host
const WS_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${WS_HOST}`

const BACKOFF_BASE_MS = 1_000
const BACKOFF_CAP_MS  = 30_000

function backoffDelay(attempt: number): number {
  const exp = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_CAP_MS)
  return Math.round(exp + exp * 0.2 * (Math.random() * 2 - 1))
}

function toBoundsMsg(b: ViewportBounds) {
  return { min_lat: b.south, max_lat: b.north, min_lng: b.west, max_lng: b.east }
}

function toSafetyEvent(e: WsEvent): SafetyEvent {
  return {
    id: e.id,
    event_type: e.event_type as EventType,
    severity: e.severity as Severity,
    title: e.title,
    summary: null,
    lat: e.lat,
    lng: e.lng,
    place_name: null,
    county: null,
    is_active: e.state !== 'RESOLVED' && e.state !== 'EXPIRED',
    state: e.state as EventState,
    started_at: e.started_at,
    created_at: e.started_at,
    nostr_event_id: null,
    bitcoin_txid: null,
  }
}

export function useViewportWs(bounds: ViewportBounds | null, zoom: number): void {
  const dispatch = useAppDispatch()
  const wsRef = useRef<WebSocket | null>(null)
  const subscribedRef = useRef(false)
  const boundsRef = useRef<ViewportBounds | null>(bounds)
  const zoomRef = useRef<number>(zoom)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCount = useRef<number>(0)

  // Send VIEWPORT_CHANGED (or late SUBSCRIBE) when bounds/zoom change
  useEffect(() => {
    boundsRef.current = bounds
    zoomRef.current = zoom
    const ws = wsRef.current
    if (!ws || ws.readyState !== 1 /* OPEN */ || !bounds) return
    if (subscribedRef.current) {
      ws.send(JSON.stringify({
        type: 'VIEWPORT_CHANGED',
        payload: { bounds: toBoundsMsg(bounds), zoom },
      }))
    } else {
      ws.send(JSON.stringify({
        type: 'SUBSCRIBE',
        payload: { bounds: toBoundsMsg(bounds), zoom },
      }))
      subscribedRef.current = true
    }
  }, [bounds, zoom])

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(`${WS_BASE}/ws/events`)
      wsRef.current = ws
      subscribedRef.current = false

      ws.onopen = () => {
        retryCount.current = 0
        if (boundsRef.current) {
          ws.send(JSON.stringify({
            type: 'SUBSCRIBE',
            payload: { bounds: toBoundsMsg(boundsRef.current), zoom: zoomRef.current },
          }))
          subscribedRef.current = true
        }
      }

      ws.onmessage = (event) => {
        try {
          const msg: ViewportServerMsg = JSON.parse(event.data as string)
          if (msg.type === 'INITIAL_BATCH' || msg.type === 'SNAPSHOT') {
            dispatch(viewportEventsSet(msg.payload.events.map(toSafetyEvent)))
          } else if (msg.type === 'DIFF_PATCH') {
            dispatch(viewportEventsBatchApply({
              added:   msg.payload.added.map(toSafetyEvent),
              removed: msg.payload.removed,
              updated: msg.payload.updated.map(toSafetyEvent),
            }))
          }
        } catch {
          console.warn('Invalid viewport WS message')
        }
      }

      ws.onclose = (event) => {
        subscribedRef.current = false
        if (event.code === 1000) {
          retryCount.current = 0
          return
        }
        const delay = backoffDelay(retryCount.current)
        retryCount.current += 1
        reconnectTimer.current = setTimeout(connect, delay)
      }

      ws.onerror = () => ws.close()
    }

    connect()
    return () => {
      wsRef.current?.close(1000)
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [dispatch])
}
