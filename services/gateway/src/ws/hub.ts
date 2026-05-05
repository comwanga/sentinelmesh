import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { Duplex } from 'stream'
import type { WsMessage } from '../../../../shared/types'

// Each client subscribes to a county. When an event arrives for that county,
// all sockets in that county's set receive it.
type CountySubscribers = Map<string, Set<WebSocket>>

export interface WsHub {
  broadcast: (county: string | null, message: WsMessage) => void
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void
}

export function createWsHub(): WsHub {
  const wss = new WebSocketServer({ noServer: true })
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

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  }

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
  return { broadcast, handleUpgrade }
}
