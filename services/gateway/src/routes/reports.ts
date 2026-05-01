import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { verifyNostrSignature } from '../nostr/verifier'
import { createReport, castVote, listReports, applyStatusTransition } from '../reports/reportService'
import { computeNewStatus } from '../reports/consensusEngine'
import type { WsHub } from '../ws/hub'

const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => String(req.body?.nostr_pubkey ?? req.ip ?? 'unknown'),
  message: { code: 'RATE_LIMITED', message: 'Max 10 reports per hour', retryable: true },
})

const voteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => String(req.body?.voter_pubkey ?? req.ip ?? 'unknown'),
  message: { code: 'RATE_LIMITED', message: 'Max 30 votes per minute', retryable: true },
})

export function createReportsRouter(hub: WsHub): Router {
  const router = Router()

  router.post('/', reportLimiter, async (req: Request, res: Response) => {
    const { report_type, description, lat, lng, place_name,
            nostr_pubkey, nostr_event, photo_ipfs_cid, linked_event_id } = req.body

    if (!report_type || lat == null || lng == null || !nostr_pubkey || !nostr_event) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Missing required fields', retryable: false })
      return
    }
    if (!verifyNostrSignature(nostr_event)) {
      res.status(401).json({ code: 'INVALID_SIGNATURE', message: 'Nostr signature verification failed', retryable: false })
      return
    }
    if (nostr_event.pubkey !== nostr_pubkey) {
      res.status(401).json({ code: 'PUBKEY_MISMATCH', message: 'Event pubkey does not match nostr_pubkey', retryable: false })
      return
    }

    try {
      const report = await createReport({
        report_type,
        description: description ?? null,
        lat: parseFloat(String(lat)),
        lng: parseFloat(String(lng)),
        place_name: place_name ?? null,
        nostr_pubkey,
        nostr_signature: nostr_event.sig as string,
        nostr_event_id: nostr_event.id as string,
        photo_ipfs_cid: photo_ipfs_cid ?? null,
        linked_event_id: linked_event_id ?? null,
      })
      hub.broadcast(null, { type: 'NEW_REPORT', payload: report })
      res.status(201).json(report)
    } catch (err) {
      console.error('POST /api/reports error:', err)
      res.status(500).json({ code: 'DB_ERROR', message: 'Could not create report', retryable: true })
    }
  })

  router.post('/:id/vote', voteLimiter, async (req: Request, res: Response) => {
    const { voter_pubkey, vote, voter_nostr_event, voter_lat, voter_lng } = req.body

    if (!voter_pubkey || !vote || !voter_nostr_event) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Missing required fields', retryable: false })
      return
    }
    if (!['CONFIRM', 'DENY'].includes(String(vote).toUpperCase())) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'vote must be CONFIRM or DENY', retryable: false })
      return
    }
    if (!verifyNostrSignature(voter_nostr_event)) {
      res.status(401).json({ code: 'INVALID_SIGNATURE', message: 'Nostr signature verification failed', retryable: false })
      return
    }

    try {
      const report = await castVote({
        report_id: req.params['id']!,
        voter_pubkey,
        vote: String(vote).toUpperCase() as 'CONFIRM' | 'DENY',
        voter_lat: voter_lat != null ? parseFloat(String(voter_lat)) : null,
        voter_lng: voter_lng != null ? parseFloat(String(voter_lng)) : null,
      })

      const newStatus = computeNewStatus(report)
      if (newStatus && newStatus !== report.status) {
        await applyStatusTransition(report, newStatus)
      }
      const finalReport = newStatus ? { ...report, status: newStatus } : report
      hub.broadcast(null, { type: 'REPORT_UPDATED', payload: finalReport })
      res.json(finalReport)
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'report not found') {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Report not found', retryable: false })
        return
      }
      if (err instanceof Error && err.message === 'cannot vote on own report') {
        res.status(403).json({ code: 'FORBIDDEN', message: 'Cannot vote on your own report', retryable: false })
        return
      }
      if ((err as { code?: string })?.code === '23505') {
        res.status(409).json({ code: 'ALREADY_VOTED', message: 'Already voted on this report', retryable: false })
        return
      }
      console.error('POST /api/reports/:id/vote error:', err)
      res.status(500).json({ code: 'DB_ERROR', message: 'Could not cast vote', retryable: true })
    }
  })

  router.get('/', async (req: Request, res: Response) => {
    const { lat, lng, radius_km, status, reporter_tier, linked_event_id, limit } = req.query
    try {
      const reports = await listReports({
        lat:             lat            ? parseFloat(String(lat))            : undefined,
        lng:             lng            ? parseFloat(String(lng))            : undefined,
        radius_km:       radius_km      ? parseFloat(String(radius_km))      : undefined,
        status:          status         ? String(status)                     : undefined,
        reporter_tier:   reporter_tier  ? String(reporter_tier)              : undefined,
        linked_event_id: linked_event_id ? String(linked_event_id)          : undefined,
        limit:           limit          ? parseInt(String(limit), 10)        : undefined,
      })
      res.json({ reports, total: reports.length })
    } catch (err) {
      console.error('GET /api/reports error:', err)
      res.status(500).json({ code: 'DB_ERROR', message: 'Could not fetch reports', retryable: true })
    }
  })

  router.get('/by-event/:event_id', async (req: Request, res: Response) => {
    try {
      const reports = await listReports({ linked_event_id: req.params['event_id'] })
      res.json({ reports, total: reports.length })
    } catch (err) {
      console.error('GET /api/reports/by-event error:', err)
      res.status(500).json({ code: 'DB_ERROR', message: 'Could not fetch reports', retryable: true })
    }
  })

  return router
}
