import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { config } from './config'
import { eventsRouter } from './routes/events'
import { zapRouter } from './routes/zap'
import { circlesRouter } from './routes/circles'
import { createLocationBlobsRouter } from './routes/locationBlobs'
import { createReportsRouter } from './routes/reports'
import { initPool } from './db/pool'
import { startEventSubscriber } from './subscribers/eventSubscriber'
import { createWsHub } from './ws/hub'
import { createCircleHub } from './ws/circleHub'
import { createServer } from 'http'

const app = express()

app.use(helmet())
app.use(cors())
app.use('/api/zaps/webhook', express.raw({ type: 'application/json' }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'gateway', ts: new Date().toISOString() })
})

app.use('/api/events', eventsRouter)
app.use('/api/zaps', zapRouter)
app.use('/api/circles', circlesRouter)

const server = createServer(app)
const wsHub = createWsHub(server)
const circleHub = createCircleHub(server)

app.use('/api/circles', createLocationBlobsRouter(circleHub))

// Mount reports router after hub is created — it needs hub to broadcast
app.use('/api/reports', createReportsRouter(wsHub))

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
