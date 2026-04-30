import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { zapRouter } from '../src/routes/zap'

export function buildTestApp() {
  const app = express()
  app.use(helmet())
  app.use(cors())
  // Keep the webhook path as raw bytes — mount express.raw before express.json
  // so the global JSON parser does not consume the body for that route.
  app.use('/api/zaps/webhook', express.raw({ type: 'application/json' }))
  app.use(express.json())
  app.use('/api/zaps', zapRouter)
  return app
}
