import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { config } from './config'
import { eventsRouter } from './routes/events'
import { initPool } from './db/pool'
import { startEventSubscriber } from './subscribers/eventSubscriber'
import { createWsHub } from './ws/hub'
import { createServer } from 'http'

const app = express()

app.use(helmet())
app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'gateway', ts: new Date().toISOString() })
})

app.use('/api/events', eventsRouter)

const server = createServer(app)
const wsHub = createWsHub(server)

initPool()
  .then(() => startEventSubscriber(wsHub))
  .then(() => {
    server.listen(config.port, () => {
      console.log(`gateway listening on port ${config.port}`)
    })
  })
  .catch((err) => {
    console.error('gateway startup failed:', err)
    process.exit(1)
  })
