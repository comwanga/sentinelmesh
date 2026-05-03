import { Router } from 'express'
import rateLimit from 'express-rate-limit'

type NudgeCallback = () => void
let nudgeCallback: NudgeCallback | null = null

export function setNudgeCallback(cb: NudgeCallback): void {
  nudgeCallback = cb
}

export const internalRouter = Router()

internalRouter.use(
  rateLimit({
    windowMs: 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
  }),
)

internalRouter.post('/nudge', (_req, res) => {
  if (nudgeCallback) nudgeCallback()
  res.json({ ok: true })
})
