import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import { verifyEvent } from 'nostr-tools'
import { getPool } from '../db/pool'
import type { CircleWsMessage } from '../../../../shared/types'

type CircleRooms = Map<string, Set<WebSocket>>

export interface CircleHub {
  broadcast: (circleId: string, message: CircleWsMessage) => void
}

export function createCircleHub(server: Server): CircleHub {
  const wss = new WebSocketServer({ server, path: '/ws/circles' })
  const rooms: CircleRooms = new Map()

  wss.on('connection', (ws: WebSocket) => {
    let joinedCircleId: string | null = null

    ws.on('message', (data) => {
      void (async () => {
        try {
          const msg = JSON.parse(data.toString()) as {
            type: string
            circle_id: string
            nostr_auth_event?: Record<string, unknown>
          }
          if (msg.type === 'join_circle' && msg.circle_id) {
            const authEvent = msg.nostr_auth_event
            if (authEvent) {
              // Verify signature, kind, and timestamp when auth event is provided
              const age = Math.floor(Date.now() / 1000) - (authEvent['created_at'] as number)
              if (age > 60 || age < -5 || (authEvent['kind'] as number) !== 27235) {
                ws.close(4001, 'Auth event invalid or stale')
                return
              }
              if (!verifyEvent(authEvent as Parameters<typeof verifyEvent>[0])) {
                ws.close(4001, 'Auth event signature invalid')
                return
              }
              const pubkey = (authEvent as { pubkey: string }).pubkey
              const pool = getPool()
              const memberCheck = await pool.query(
                `SELECT 1 FROM circle_members WHERE circle_id = $1 AND member_pubkey = $2
                 UNION
                 SELECT 1 FROM circles WHERE circle_id = $1 AND owner_pubkey = $2
                 LIMIT 1`,
                [msg.circle_id, pubkey],
              )
              if (memberCheck.rowCount === 0) {
                ws.close(4003, 'Not a circle member')
                return
              }
            } else {
              console.warn(`[circle-ws] join_circle without auth event for circle ${msg.circle_id} — Phase 4 will require it`)
            }
            if (joinedCircleId) rooms.get(joinedCircleId)?.delete(ws)
            joinedCircleId = msg.circle_id
            if (!rooms.has(joinedCircleId)) rooms.set(joinedCircleId, new Set())
            rooms.get(joinedCircleId)!.add(ws)
          }
        } catch { /* ignore malformed messages */ }
      })()
    })

    ws.on('close', () => {
      if (joinedCircleId) rooms.get(joinedCircleId)?.delete(ws)
    })

    ws.on('error', () => {
      if (joinedCircleId) rooms.get(joinedCircleId)?.delete(ws)
    })
  })

  function broadcast(circleId: string, message: CircleWsMessage): void {
    const payload = JSON.stringify(message)
    rooms.get(circleId)?.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload)
    })
  }

  console.log('Circle WebSocket hub ready on /ws/circles')
  return { broadcast }
}
