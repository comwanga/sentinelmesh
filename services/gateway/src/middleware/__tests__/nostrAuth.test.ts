import { describe, it, expect, vi } from 'vitest'
import { Request, Response, NextFunction } from 'express'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools'
import { requireNostrAuth } from '../nostrAuth'

function makeAuthEvent(sk: Uint8Array) {
  return JSON.stringify(finalizeEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: '',
  }, sk))
}

function makeReq(authHeader?: string): Partial<Request> {
  return {
    headers: authHeader ? { 'x-nostr-auth': authHeader } : {},
    nostrPubkey: undefined,
  } as Partial<Request>
}

describe('requireNostrAuth', () => {
  it('calls next and sets req.nostrPubkey for valid signed event', () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const req = makeReq(makeAuthEvent(sk)) as Request
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    const next = vi.fn() as NextFunction

    requireNostrAuth(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.nostrPubkey).toBe(pk)
  })

  it('returns 401 when header is missing', () => {
    const req = makeReq() as Request
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    const next = vi.fn() as NextFunction

    requireNostrAuth(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 for invalid signature', () => {
    const sk = generateSecretKey()
    const event = JSON.parse(makeAuthEvent(sk))
    event.sig = 'a'.repeat(128)
    const req = makeReq(JSON.stringify(event)) as Request
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    const next = vi.fn() as NextFunction

    requireNostrAuth(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('returns 401 for stale timestamp (> 60 s)', () => {
    const sk = generateSecretKey()
    const event = finalizeEvent({
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000) - 120,
      tags: [],
      content: '',
    }, sk)
    const req = makeReq(JSON.stringify(event)) as Request
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    const next = vi.fn() as NextFunction

    requireNostrAuth(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
  })
})
