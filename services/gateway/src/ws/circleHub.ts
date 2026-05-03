import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
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
      try {
        const msg = JSON.parse(data.toString()) as { type: string; circle_id: string }
        if (msg.type === 'join_circle' && msg.circle_id) {
          if (joinedCircleId) rooms.get(joinedCircleId)?.delete(ws)
          joinedCircleId = msg.circle_id
          if (!rooms.has(joinedCircleId)) rooms.set(joinedCircleId, new Set())
          rooms.get(joinedCircleId)!.add(ws)
        }
      } catch { /* ignore invalid messages */ }
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
