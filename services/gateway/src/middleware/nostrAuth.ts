import { Request, Response, NextFunction } from 'express'
import { verifyEvent } from 'nostr-tools'

declare global {
  namespace Express {
    interface Request {
      nostrPubkey?: string
    }
  }
}

export function requireNostrAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['x-nostr-auth'] as string | undefined
  if (!header) {
    res.status(401).json({ code: 'MISSING_AUTH', message: 'X-Nostr-Auth header required', retryable: false })
    return
  }

  let event: Record<string, unknown>
  try {
    event = JSON.parse(header)
  } catch {
    res.status(401).json({ code: 'INVALID_AUTH', message: 'Could not parse auth event', retryable: false })
    return
  }

  const age = Math.floor(Date.now() / 1000) - (event['created_at'] as number)
  if (age > 60 || age < -5) {
    res.status(401).json({ code: 'STALE_AUTH', message: 'Auth event is too old or in the future', retryable: false })
    return
  }

  if (!verifyEvent(event as Parameters<typeof verifyEvent>[0])) {
    res.status(401).json({ code: 'INVALID_SIG', message: 'Signature verification failed', retryable: false })
    return
  }

  req.nostrPubkey = (event as { pubkey: string }).pubkey
  next()
}
