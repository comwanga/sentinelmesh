import express from 'express'
import { createServer } from 'http'
import { config } from './config'
import { initPool, closePool } from './db/pool'
import { startPublishWorker } from './workers/publishWorker'
import { internalRouter, setNudgeCallback } from './routes/internal'

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'blockchain', ts: new Date().toISOString() })
})

app.use('/internal', internalRouter)

const server = createServer(app)

async function main(): Promise<void> {
  await initPool()

  const { triggerNudge } = startPublishWorker()
  setNudgeCallback(triggerNudge)

  server.listen(config.port, () => {
    console.log(`[blockchain] listening on port ${config.port}`)
  })
}

async function shutdown(): Promise<void> {
  server.close()
  await closePool()
}

process.on('SIGTERM', () => shutdown().then(() => process.exit(0)).catch(() => process.exit(1)))
process.on('SIGINT', () => shutdown().then(() => process.exit(0)).catch(() => process.exit(1)))

main().catch(err => {
  console.error('[blockchain] startup failed:', err)
  process.exit(1)
})
