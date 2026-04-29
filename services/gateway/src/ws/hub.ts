import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage, Server } from 'http'
import type { WsMessage } from '../../../../shared/types'

// Each client subscribes to a county. When an event arrives for that county,
// all sockets in that county's set receive it.
type CountySubscribers = Map<string, Set<WebSocket>>

export interface WsHub {
  broadcast: (county: string | null, message: WsMessage) => void
}

export function createWsHub(server: Server): WsHub {
  const wss = new WebSocketServer({ server, path: '/ws' })
  const subscribers: CountySubscribers = new Map()

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    const county = url.searchParams.get('county')?.toLowerCase() ?? 'global'

    if (!subscribers.has(county)) subscribers.set(county, new Set())
    subscribers.get(county)!.add(ws)

    ws.on('close', () => {
      subscribers.get(county)?.delete(ws)
    })

    ws.on('error', () => {
      subscribers.get(county)?.delete(ws)
    })
  })

  function broadcast(county: string | null, message: WsMessage): void {
    const payload = JSON.stringify(message)
    const targets = new Set<WebSocket>()

    // Send to county subscribers and to global subscribers
    const countyKey = county?.toLowerCase() ?? 'global'
    subscribers.get(countyKey)?.forEach(ws => targets.add(ws))
    subscribers.get('global')?.forEach(ws => targets.add(ws))

    targets.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload)
      }
    })
  }

  console.log('WebSocket hub ready on /ws')
  return { broadcast }
}
