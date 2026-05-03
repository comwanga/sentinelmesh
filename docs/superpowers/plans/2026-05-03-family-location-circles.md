# Family Location Circles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 3 of SentinelMesh — a zero-knowledge, E2EE family location sharing dashboard with a three-panel PWA layout integrated into the existing React + Redux + Mapbox stack.

**Architecture:** Client-side AES-256-GCM encrypts GPS coordinates before posting opaque blobs to the gateway; the gateway stores and relays blobs it cannot read. Proximity alerts fire client-side only, comparing decrypted member locations against active Phase 1 safety events using haversine distance. The UI is a three-panel command layout: fixed `w-64` sidebar left, Mapbox map center, scrollable alert log pinned at `h-1/4` below the map.

**Tech Stack:** React 18 + Vite + TypeScript strict, Redux Toolkit, react-map-gl 8 + Mapbox GL 3, Web Crypto API (X25519 + AES-256-GCM), nostr-tools v2, Express 4 + pg + ws (gateway), Vitest + React Testing Library

---

## File Map

**Create:**
- `apps/pwa/src/services/e2eeService.ts` — Web Crypto wrapper: key generation, wrap/unwrap, encrypt/decrypt
- `apps/pwa/src/services/__tests__/e2eeService.test.ts`
- `apps/pwa/src/services/circleWebSocket.ts` — client WS hook for circle room
- `apps/pwa/src/services/locationPublisher.ts` — 30 s encrypt-and-POST loop
- `apps/pwa/src/store/circlesSlice.ts` — Redux state: circles, members, statuses, locations, alerts
- `apps/pwa/src/store/__tests__/circlesSlice.test.ts`
- `apps/pwa/src/hooks/useProximityAlerts.ts` — detects proximity, dispatches alerts
- `apps/pwa/src/hooks/__tests__/useProximityAlerts.test.ts`
- `apps/pwa/src/components/MemberChip.tsx` — status-ring pill component
- `apps/pwa/src/components/__tests__/MemberChip.test.tsx`
- `apps/pwa/src/components/X25519Badge.tsx` — pulsing encryption badge
- `apps/pwa/src/components/CircleMapLayer.tsx` — Mapbox Marker nodes for ONLINE members
- `apps/pwa/src/components/__tests__/CircleMapLayer.test.tsx`
- `apps/pwa/src/components/AlertBanner.tsx` — conditional top banner
- `apps/pwa/src/components/__tests__/AlertBanner.test.tsx`
- `apps/pwa/src/components/ProximityAlertLog.tsx` — scrollable alert feed
- `apps/pwa/src/components/__tests__/ProximityAlertLog.test.tsx`
- `apps/pwa/src/components/InviteModal.tsx` — invite generation + display
- `apps/pwa/src/components/__tests__/InviteModal.test.tsx`
- `apps/pwa/src/components/CircleSidebar.tsx` — fixed left panel
- `apps/pwa/src/components/__tests__/CircleSidebar.test.tsx`
- `apps/pwa/src/components/FamilyCircleDashboard.tsx` — top-level page
- `apps/pwa/src/components/__tests__/FamilyCircleDashboard.test.tsx`
- `services/gateway/src/middleware/nostrAuth.ts` — Express middleware: verifies Nostr sig
- `services/gateway/src/middleware/__tests__/nostrAuth.test.ts`
- `services/gateway/src/routes/circles.ts` — circle + member CRUD
- `services/gateway/src/routes/__tests__/circles.test.ts`
- `services/gateway/src/routes/locationBlobs.ts` — encrypted blob POST/GET
- `services/gateway/src/routes/__tests__/locationBlobs.test.ts`
- `services/gateway/src/ws/circleHub.ts` — WS hub for circle rooms

**Modify:**
- `shared/types/index.d.ts` — add `Circle`, `CircleMember`, `MemberStatus`, `ProximityAlert`, `CircleWsMessage`
- `apps/pwa/src/utils/geo.ts` — export `haversineKm`
- `apps/pwa/src/store/index.ts` — add `circlesReducer`
- `apps/pwa/src/App.tsx` — add Family Circles tab/view
- `services/gateway/src/index.ts` — mount circle routes + circleHub

---

## Task 1: Shared types + export haversineKm

**Files:**
- Modify: `shared/types/index.d.ts`
- Modify: `apps/pwa/src/utils/geo.ts`

- [ ] **Step 1: Add Phase 3 types to shared/types/index.d.ts**

Append to the end of `shared/types/index.d.ts`:

```typescript
export type MemberStatus = 'ONLINE' | 'GHOST' | 'OFFLINE'

export interface Circle {
  circle_id: string
  owner_pubkey: string
  name: string
  created_at: string
}

export interface CircleMember {
  circle_id: string
  member_pubkey: string
  alert_radius_km: number
  alert_severity: Severity
  joined_at: string
}

export interface ProximityAlert {
  id: string
  member_pubkey: string
  zone_name: string
  event_id: string | null
  severity: Severity
  triggered_at: string
}

export type CircleWsMessage =
  | { type: 'CIRCLE_LOCATION_BLOB'; payload: { sender_pubkey: string; encrypted_payload: string; sent_at: string } }
  | { type: 'CIRCLE_PRESENCE';      payload: { sender_pubkey: string; mode: 'GHOST' | 'OFFLINE' } }
```

- [ ] **Step 2: Export haversineKm from geo.ts**

In `apps/pwa/src/utils/geo.ts`, change the `haversineKm` function from a local function to an export:

```typescript
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD
  const dLng = (b.lng - a.lng) * DEG_TO_RAD
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h = sinDLat * sinDLat +
    Math.cos(a.lat * DEG_TO_RAD) * Math.cos(b.lat * DEG_TO_RAD) * sinDLng * sinDLng
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}
```

- [ ] **Step 3: Commit**

```bash
git add shared/types/index.d.ts apps/pwa/src/utils/geo.ts
git commit -m "feat: add Phase 3 shared types and export haversineKm"
```

---

## Task 2: E2EE service (TDD)

**Files:**
- Create: `apps/pwa/src/services/e2eeService.ts`
- Create: `apps/pwa/src/services/__tests__/e2eeService.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/pwa/src/services/__tests__/e2eeService.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  generateCircleKey,
  saveCircleKey,
  loadCircleKey,
  clearCircleKey,
  encryptLocation,
  decryptLocation,
  generateEphemeralKeypair,
  wrapCircleKey,
  unwrapCircleKey,
} from '../e2eeService'

describe('generateCircleKey', () => {
  it('returns a CryptoKey for AES-GCM', async () => {
    const key = await generateCircleKey()
    expect(key.type).toBe('secret')
    expect(key.algorithm.name).toBe('AES-GCM')
  })
})

describe('saveCircleKey / loadCircleKey / clearCircleKey', () => {
  it('round-trips a circle key through localStorage', async () => {
    const key = await generateCircleKey()
    await saveCircleKey('test-circle', key)

    const loaded = await loadCircleKey('test-circle')
    expect(loaded).not.toBeNull()
    expect(loaded!.type).toBe('secret')

    clearCircleKey('test-circle')
    expect(await loadCircleKey('test-circle')).toBeNull()
  })
})

describe('encryptLocation / decryptLocation', () => {
  it('round-trips lat/lng', async () => {
    const key = await generateCircleKey()
    const ciphertext = await encryptLocation(key, -1.2921, 36.8219)
    const result = await decryptLocation(key, ciphertext)
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(-1.2921)
    expect(result!.lng).toBeCloseTo(36.8219)
    expect(result!.ts).toBeDefined()
  })

  it('returns null for corrupted ciphertext', async () => {
    const key = await generateCircleKey()
    const result = await decryptLocation(key, 'bm90dmFsaWQ=')
    expect(result).toBeNull()
  })
})

describe('wrapCircleKey / unwrapCircleKey', () => {
  it('round-trips a circle key through X25519 wrapping', async () => {
    const circleKey = await generateCircleKey()
    const inviter = await generateEphemeralKeypair()
    const recipient = await generateEphemeralKeypair()

    const wrapped = await wrapCircleKey(circleKey, inviter.privateKey, recipient.publicKey)
    const unwrapped = await unwrapCircleKey(wrapped, recipient.privateKey, inviter.publicKey)

    // Verify the unwrapped key can decrypt what the original encrypted
    const ciphertext = await encryptLocation(circleKey, -1.0, 36.0)
    const result = await decryptLocation(unwrapped, ciphertext)
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(-1.0)
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd apps/pwa && npx vitest run src/services/__tests__/e2eeService.test.ts
```

Expected: FAIL — `Cannot find module '../e2eeService'`

- [ ] **Step 3: Implement e2eeService.ts**

Create `apps/pwa/src/services/e2eeService.ts`:

```typescript
const CIRCLE_KEY_PREFIX = 'sentinelmesh:circle_key:'

export async function generateCircleKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

export async function saveCircleKey(circleId: string, key: CryptoKey): Promise<void> {
  const raw = await crypto.subtle.exportKey('raw', key)
  const b64 = btoa(String.fromCharCode(...new Uint8Array(raw)))
  localStorage.setItem(CIRCLE_KEY_PREFIX + circleId, b64)
}

export async function loadCircleKey(circleId: string): Promise<CryptoKey | null> {
  const b64 = localStorage.getItem(CIRCLE_KEY_PREFIX + circleId)
  if (!b64) return null
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export function clearCircleKey(circleId: string): void {
  localStorage.removeItem(CIRCLE_KEY_PREFIX + circleId)
}

export async function generateEphemeralKeypair(): Promise<{ publicKey: Uint8Array; privateKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'X25519' } as AlgorithmIdentifier, true, ['deriveKey', 'deriveBits'])
  const rawPub = await crypto.subtle.exportKey('raw', (pair as CryptoKeyPair).publicKey)
  return { publicKey: new Uint8Array(rawPub), privateKey: (pair as CryptoKeyPair).privateKey }
}

async function deriveWrappingKey(myPrivKey: CryptoKey, theirPubBytes: Uint8Array): Promise<CryptoKey> {
  const theirPub = await crypto.subtle.importKey('raw', theirPubBytes, { name: 'X25519' } as AlgorithmIdentifier, false, [])
  const bits = await crypto.subtle.deriveBits({ name: 'X25519', public: theirPub } as AlgorithmIdentifier, myPrivKey, 256)
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function encodeB64(iv: Uint8Array, data: ArrayBuffer): string {
  const combined = new Uint8Array(iv.byteLength + data.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(data), iv.byteLength)
  return btoa(String.fromCharCode(...combined))
}

function decodeB64(b64: string): { iv: Uint8Array; data: Uint8Array } | null {
  try {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    if (bytes.length < 13) return null
    return { iv: bytes.slice(0, 12), data: bytes.slice(12) }
  } catch {
    return null
  }
}

export async function wrapCircleKey(
  circleKey: CryptoKey,
  myPrivKey: CryptoKey,
  theirPubBytes: Uint8Array,
): Promise<string> {
  const wrappingKey = await deriveWrappingKey(myPrivKey, theirPubBytes)
  const rawCircleKey = await crypto.subtle.exportKey('raw', circleKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, rawCircleKey)
  return encodeB64(iv, wrapped)
}

export async function unwrapCircleKey(
  wrappedB64: string,
  myPrivKey: CryptoKey,
  theirPubBytes: Uint8Array,
): Promise<CryptoKey> {
  const wrappingKey = await deriveWrappingKey(myPrivKey, theirPubBytes)
  const decoded = decodeB64(wrappedB64)
  if (!decoded) throw new Error('Invalid wrapped key encoding')
  const rawCircleKey = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decoded.iv }, wrappingKey, decoded.data)
  return crypto.subtle.importKey('raw', rawCircleKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptLocation(circleKey: CryptoKey, lat: number, lng: number): Promise<string> {
  const payload = JSON.stringify({ lat, lng, ts: new Date().toISOString() })
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, circleKey, enc.encode(payload))
  return encodeB64(iv, ciphertext)
}

export async function decryptLocation(
  circleKey: CryptoKey,
  ciphertextB64: string,
): Promise<{ lat: number; lng: number; ts: string } | null> {
  try {
    const decoded = decodeB64(ciphertextB64)
    if (!decoded) return null
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decoded.iv }, circleKey, decoded.data)
    return JSON.parse(new TextDecoder().decode(plain)) as { lat: number; lng: number; ts: string }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd apps/pwa && npx vitest run src/services/__tests__/e2eeService.test.ts
```

Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/services/e2eeService.ts apps/pwa/src/services/__tests__/e2eeService.test.ts
git commit -m "feat: add E2EE service with X25519 key wrapping and AES-256-GCM location encrypt"
```

---

## Task 3: circlesSlice (TDD)

**Files:**
- Create: `apps/pwa/src/store/circlesSlice.ts`
- Create: `apps/pwa/src/store/__tests__/circlesSlice.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/pwa/src/store/__tests__/circlesSlice.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import reducer, {
  circleLoaded,
  memberStatusUpdated,
  locationReceived,
  proximityAlertAdded,
  activeAlertDismissed,
  circleLeft,
} from '../circlesSlice'
import type { Circle, CircleMember } from '../../../../../shared/types'

const mockCircle: Circle = {
  circle_id: 'c1',
  owner_pubkey: 'aaa',
  name: 'Wanga Family',
  created_at: '2026-05-03T00:00:00Z',
}

const mockMember: CircleMember = {
  circle_id: 'c1',
  member_pubkey: 'bbb',
  alert_radius_km: 1,
  alert_severity: 'HIGH',
  joined_at: '2026-05-03T00:00:00Z',
}

describe('circlesSlice', () => {
  it('loads circle and members', () => {
    const state = reducer(undefined, circleLoaded({ circle: mockCircle, members: [mockMember] }))
    expect(state.activeCircleId).toBe('c1')
    expect(state.circles).toHaveLength(1)
    expect(state.members['c1']).toHaveLength(1)
  })

  it('updates member status', () => {
    let state = reducer(undefined, circleLoaded({ circle: mockCircle, members: [mockMember] }))
    state = reducer(state, memberStatusUpdated({ pubkey: 'bbb', status: 'GHOST' }))
    expect(state.memberStatuses['bbb']).toBe('GHOST')
  })

  it('stores decrypted location', () => {
    const state = reducer(undefined, locationReceived({ pubkey: 'bbb', lat: -1.29, lng: 36.82, ts: '2026-05-03T00:00:00Z' }))
    expect(state.decryptedLocations['bbb']?.lat).toBeCloseTo(-1.29)
  })

  it('adds proximity alert and sets activeAlert', () => {
    const alert = { id: 'a1', member_pubkey: 'bbb', zone_name: 'Crisis Zone B', event_id: 'e1', severity: 'HIGH' as const, triggered_at: '2026-05-03T00:00:00Z' }
    const state = reducer(undefined, proximityAlertAdded(alert))
    expect(state.proximityAlerts).toHaveLength(1)
    expect(state.activeAlert?.id).toBe('a1')
  })

  it('dismisses active alert without removing from log', () => {
    const alert = { id: 'a1', member_pubkey: 'bbb', zone_name: 'Zone B', event_id: null, severity: 'HIGH' as const, triggered_at: '2026-05-03T00:00:00Z' }
    let state = reducer(undefined, proximityAlertAdded(alert))
    state = reducer(state, activeAlertDismissed())
    expect(state.activeAlert).toBeNull()
    expect(state.proximityAlerts).toHaveLength(1)
  })

  it('clears all circle state on circleLeft', () => {
    let state = reducer(undefined, circleLoaded({ circle: mockCircle, members: [mockMember] }))
    state = reducer(state, circleLeft())
    expect(state.activeCircleId).toBeNull()
    expect(state.circles).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd apps/pwa && npx vitest run src/store/__tests__/circlesSlice.test.ts
```

Expected: FAIL — `Cannot find module '../circlesSlice'`

- [ ] **Step 3: Implement circlesSlice.ts**

Create `apps/pwa/src/store/circlesSlice.ts`:

```typescript
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { Circle, CircleMember, MemberStatus, ProximityAlert } from '../../../../shared/types'

interface DecryptedLocation { lat: number; lng: number; ts: string }

interface CirclesState {
  circles: Circle[]
  activeCircleId: string | null
  members: Record<string, CircleMember[]>
  memberStatuses: Record<string, MemberStatus>
  decryptedLocations: Record<string, DecryptedLocation>
  proximityAlerts: ProximityAlert[]
  activeAlert: ProximityAlert | null
}

const initialState: CirclesState = {
  circles: [],
  activeCircleId: null,
  members: {},
  memberStatuses: {},
  decryptedLocations: {},
  proximityAlerts: [],
  activeAlert: null,
}

const circlesSlice = createSlice({
  name: 'circles',
  initialState,
  reducers: {
    circleLoaded(state, action: PayloadAction<{ circle: Circle; members: CircleMember[] }>) {
      const { circle, members } = action.payload
      const existing = state.circles.findIndex(c => c.circle_id === circle.circle_id)
      if (existing >= 0) {
        state.circles[existing] = circle
      } else {
        state.circles.push(circle)
      }
      state.members[circle.circle_id] = members
      state.activeCircleId = circle.circle_id
      members.forEach(m => {
        if (!state.memberStatuses[m.member_pubkey]) {
          state.memberStatuses[m.member_pubkey] = 'OFFLINE'
        }
      })
    },
    memberStatusUpdated(state, action: PayloadAction<{ pubkey: string; status: MemberStatus }>) {
      state.memberStatuses[action.payload.pubkey] = action.payload.status
    },
    locationReceived(state, action: PayloadAction<{ pubkey: string; lat: number; lng: number; ts: string }>) {
      const { pubkey, lat, lng, ts } = action.payload
      state.decryptedLocations[pubkey] = { lat, lng, ts }
      state.memberStatuses[pubkey] = 'ONLINE'
    },
    proximityAlertAdded(state, action: PayloadAction<ProximityAlert>) {
      const exists = state.proximityAlerts.some(a => a.id === action.payload.id)
      if (!exists) {
        state.proximityAlerts.unshift(action.payload)
        state.activeAlert = action.payload
      }
    },
    activeAlertDismissed(state) {
      state.activeAlert = null
    },
    circleLeft(state) {
      state.circles = []
      state.activeCircleId = null
      state.members = {}
      state.memberStatuses = {}
      state.decryptedLocations = {}
      state.proximityAlerts = []
      state.activeAlert = null
    },
  },
})

export const {
  circleLoaded,
  memberStatusUpdated,
  locationReceived,
  proximityAlertAdded,
  activeAlertDismissed,
  circleLeft,
} = circlesSlice.actions
export default circlesSlice.reducer
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd apps/pwa && npx vitest run src/store/__tests__/circlesSlice.test.ts
```

Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/store/circlesSlice.ts apps/pwa/src/store/__tests__/circlesSlice.test.ts
git commit -m "feat: add circlesSlice with member status, location, and proximity alert state"
```

---

## Task 4: Nostr auth middleware (TDD)

**Files:**
- Create: `services/gateway/src/middleware/nostrAuth.ts`
- Create: `services/gateway/src/middleware/__tests__/nostrAuth.test.ts`

- [ ] **Step 1: Write failing tests**

Create `services/gateway/src/middleware/__tests__/nostrAuth.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd services/gateway && npx vitest run src/middleware/__tests__/nostrAuth.test.ts
```

Expected: FAIL — `Cannot find module '../nostrAuth'`

- [ ] **Step 3: Extend Express Request type and implement middleware**

Create `services/gateway/src/middleware/nostrAuth.ts`:

```typescript
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

  let event: ReturnType<typeof verifyEvent extends (e: infer E) => unknown ? (e: E) => E : never>
  try {
    event = JSON.parse(header)
  } catch {
    res.status(401).json({ code: 'INVALID_AUTH', message: 'Could not parse auth event', retryable: false })
    return
  }

  const age = Math.floor(Date.now() / 1000) - (event as { created_at: number }).created_at
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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd services/gateway && npx vitest run src/middleware/__tests__/nostrAuth.test.ts
```

Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add services/gateway/src/middleware/nostrAuth.ts services/gateway/src/middleware/__tests__/nostrAuth.test.ts
git commit -m "feat: add Nostr HTTP auth middleware with signature and timestamp verification"
```

---

## Task 5: Circle CRUD routes (TDD)

**Files:**
- Create: `services/gateway/src/routes/circles.ts`
- Create: `services/gateway/src/routes/__tests__/circles.test.ts`

- [ ] **Step 1: Write failing tests**

Create `services/gateway/src/routes/__tests__/circles.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { circlesRouter } from '../circles'

vi.mock('../../db/pool', () => ({
  getPool: () => ({
    query: vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes('INSERT INTO circles')) {
        return { rows: [{ circle_id: 'c1', owner_pubkey: params![1], name: params![0], created_at: new Date().toISOString() }], rowCount: 1 }
      }
      if (sql.includes('SELECT * FROM circles')) {
        return { rows: [{ circle_id: 'c1', owner_pubkey: 'aaa', name: 'Test', created_at: '' }], rowCount: 1 }
      }
      if (sql.includes('circle_members')) {
        return { rows: [], rowCount: 0 }
      }
      return { rows: [], rowCount: 0 }
    }),
  }),
}))

vi.mock('../../middleware/nostrAuth', () => ({
  requireNostrAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.nostrPubkey = 'aaa'
    next()
  },
}))

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/circles', circlesRouter)
  return app
}

describe('POST /api/circles', () => {
  it('creates a circle and returns circle_id', async () => {
    const res = await request(makeApp())
      .post('/api/circles')
      .send({ name: 'Wanga Family' })
    expect(res.status).toBe(201)
    expect(res.body.circle_id).toBe('c1')
  })

  it('returns 400 when name is missing', async () => {
    const res = await request(makeApp()).post('/api/circles').send({})
    expect(res.status).toBe(400)
  })
})

describe('GET /api/circles/:id', () => {
  it('returns circle with members array', async () => {
    const res = await request(makeApp()).get('/api/circles/c1')
    expect(res.status).toBe(200)
    expect(res.body.circle_id).toBe('c1')
    expect(Array.isArray(res.body.members)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd services/gateway && npx vitest run src/routes/__tests__/circles.test.ts
```

Expected: FAIL — `Cannot find module '../circles'`

- [ ] **Step 3: Implement circles.ts**

Create `services/gateway/src/routes/circles.ts`:

```typescript
import { Router, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { getPool } from '../db/pool'
import { requireNostrAuth } from '../middleware/nostrAuth'

export const circlesRouter = Router()

// POST /api/circles
circlesRouter.post('/', requireNostrAuth, async (req: Request, res: Response) => {
  const { name } = req.body as { name?: string }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ code: 'INVALID_INPUT', message: 'name is required', retryable: false })
    return
  }
  const circle_id = randomUUID()
  const pool = getPool()
  try {
    const result = await pool.query(
      'INSERT INTO circles (circle_id, owner_pubkey, name) VALUES ($1, $2, $3) RETURNING *',
      [circle_id, req.nostrPubkey, name.trim()],
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('POST /api/circles error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not create circle', retryable: true })
  }
})

// GET /api/circles/:id
circlesRouter.get('/:id', requireNostrAuth, async (req: Request, res: Response) => {
  const pool = getPool()
  try {
    const [circleResult, membersResult] = await Promise.all([
      pool.query('SELECT * FROM circles WHERE circle_id = $1', [req.params['id']]),
      pool.query('SELECT * FROM circle_members WHERE circle_id = $1', [req.params['id']]),
    ])
    if (circleResult.rowCount === 0) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Circle not found', retryable: false })
      return
    }
    res.json({ ...circleResult.rows[0], members: membersResult.rows })
  } catch (err) {
    console.error('GET /api/circles/:id error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not fetch circle', retryable: true })
  }
})

// POST /api/circles/:id/members
circlesRouter.post('/:id/members', requireNostrAuth, async (req: Request, res: Response) => {
  const pool = getPool()
  const { member_pubkey, alert_radius_km = 1, alert_severity = 'HIGH' } = req.body as {
    member_pubkey?: string
    alert_radius_km?: number
    alert_severity?: string
  }
  if (!member_pubkey) {
    res.status(400).json({ code: 'INVALID_INPUT', message: 'member_pubkey is required', retryable: false })
    return
  }
  try {
    const circleResult = await pool.query(
      'SELECT owner_pubkey FROM circles WHERE circle_id = $1', [req.params['id']],
    )
    if (circleResult.rowCount === 0) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Circle not found', retryable: false })
      return
    }
    if (circleResult.rows[0].owner_pubkey !== req.nostrPubkey) {
      res.status(403).json({ code: 'FORBIDDEN', message: 'Only the circle owner can add members', retryable: false })
      return
    }
    const result = await pool.query(
      `INSERT INTO circle_members (circle_id, member_pubkey, alert_radius_km, alert_severity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (circle_id, member_pubkey) DO UPDATE
         SET alert_radius_km = EXCLUDED.alert_radius_km,
             alert_severity  = EXCLUDED.alert_severity
       RETURNING *`,
      [req.params['id'], member_pubkey, alert_radius_km, alert_severity],
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    console.error('POST /api/circles/:id/members error:', err)
    res.status(500).json({ code: 'DB_ERROR', message: 'Could not add member', retryable: true })
  }
})

// DELETE /api/circles/:id/members/:pubkey
circlesRouter.delete('/:id/members/:pubkey', requireNostrAuth, async (req: Request, res: Response) => {
  const pool = getPool()
  const { id, pubkey } = req.params as { id: string; pubkey: string }
  const isSelf = req.nostrPubkey === pubkey
  if (!isSelf) {
    const circleResult = await pool.query('SELECT owner_pubkey FROM circles WHERE circle_id = $1', [id])
    if (circleResult.rowCount === 0 || circleResult.rows[0].owner_pubkey !== req.nostrPubkey) {
      res.status(403).json({ code: 'FORBIDDEN', message: 'Only owner or self can remove members', retryable: false })
      return
    }
  }
  await pool.query('DELETE FROM circle_members WHERE circle_id = $1 AND member_pubkey = $2', [id, pubkey])
  res.status(204).send()
})

// DELETE /api/circles/:id
circlesRouter.delete('/:id', requireNostrAuth, async (req: Request, res: Response) => {
  const pool = getPool()
  const circleResult = await pool.query('SELECT owner_pubkey FROM circles WHERE circle_id = $1', [req.params['id']])
  if (circleResult.rowCount === 0) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Circle not found', retryable: false })
    return
  }
  if (circleResult.rows[0].owner_pubkey !== req.nostrPubkey) {
    res.status(403).json({ code: 'FORBIDDEN', message: 'Only owner can delete circle', retryable: false })
    return
  }
  await pool.query('DELETE FROM circles WHERE circle_id = $1', [req.params['id']])
  res.status(204).send()
})
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd services/gateway && npx vitest run src/routes/__tests__/circles.test.ts
```

Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add services/gateway/src/routes/circles.ts services/gateway/src/routes/__tests__/circles.test.ts
git commit -m "feat: add circle CRUD routes with Nostr auth"
```

---

## Task 6: Location blob routes (TDD)

**Files:**
- Create: `services/gateway/src/routes/locationBlobs.ts`
- Create: `services/gateway/src/routes/__tests__/locationBlobs.test.ts`

- [ ] **Step 1: Write failing tests**

Create `services/gateway/src/routes/__tests__/locationBlobs.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createLocationBlobsRouter } from '../locationBlobs'
import type { CircleHub } from '../../ws/circleHub'

const mockHub: CircleHub = { broadcast: vi.fn() }

vi.mock('../../db/pool', () => ({
  getPool: () => ({
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('INSERT')) {
        return { rows: [{ blob_id: 'b1', sender_pubkey: 'aaa', encrypted_payload: 'abc', sent_at: '', expires_at: '' }], rowCount: 1 }
      }
      if (sql.includes('SELECT')) {
        return { rows: [{ blob_id: 'b1', sender_pubkey: 'aaa', encrypted_payload: 'abc', sent_at: new Date().toISOString() }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }),
  }),
}))

vi.mock('../../middleware/nostrAuth', () => ({
  requireNostrAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.nostrPubkey = 'aaa'
    next()
  },
}))

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/circles', createLocationBlobsRouter(mockHub))
  return app
}

describe('POST /api/circles/:id/location', () => {
  it('stores blob and broadcasts to circle hub', async () => {
    const res = await request(makeApp())
      .post('/api/circles/c1/location')
      .send({ sender_pubkey: 'aaa', encrypted_payload: 'abc123' })
    expect(res.status).toBe(201)
    expect(mockHub.broadcast).toHaveBeenCalledWith('c1', expect.objectContaining({ type: 'CIRCLE_LOCATION_BLOB' }))
  })

  it('returns 400 when encrypted_payload is missing', async () => {
    const res = await request(makeApp())
      .post('/api/circles/c1/location')
      .send({ sender_pubkey: 'aaa' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/circles/:id/location', () => {
  it('returns non-expired blobs', async () => {
    const res = await request(makeApp()).get('/api/circles/c1/location')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.blobs)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd services/gateway && npx vitest run src/routes/__tests__/locationBlobs.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create circleHub type first (needed by locationBlobs)**

Create `services/gateway/src/ws/circleHub.ts`:

```typescript
import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import type { CircleWsMessage } from '../../../../shared/types'

type CircleRooms = Map<string, Set<WebSocket>>

export interface CircleHub {
  broadcast: (circleId: string, message: CircleWsMessage) => void
}

export function createCircleHub(server: Server): CircleHub {
  const wss = new WebSocketServer({ server, path: '/ws/circles' })
  const rooms: CircleRooms = new Map()

  wss.on('connection', (ws: WebSocket) => {
    let joinedCircleId: string | null = null

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string; circle_id: string }
        if (msg.type === 'join_circle' && msg.circle_id) {
          if (joinedCircleId) rooms.get(joinedCircleId)?.delete(ws)
          joinedCircleId = msg.circle_id
          if (!rooms.has(joinedCircleId)) rooms.set(joinedCircleId, new Set())
          rooms.get(joinedCircleId)!.add(ws)
        }
      } catch { /* ignore invalid messages */ }
    })

    ws.on('close', () => {
      if (joinedCircleId) rooms.get(joinedCircleId)?.delete(ws)
    })

    ws.on('error', () => {
      if (joinedCircleId) rooms.get(joinedCircleId)?.delete(ws)
    })
  })

  function broadcast(circleId: string, message: CircleWsMessage): void {
    const payload = JSON.stringify(message)
    rooms.get(circleId)?.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload)
    })
  }

  console.log('Circle WebSocket hub ready on /ws/circles')
  return { broadcast }
}
```

- [ ] **Step 4: Implement locationBlobs.ts**

Create `services/gateway/src/routes/locationBlobs.ts`:

```typescript
import { Router, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { getPool } from '../db/pool'
import { requireNostrAuth } from '../middleware/nostrAuth'
import type { CircleHub } from '../ws/circleHub'

export function createLocationBlobsRouter(circleHub: CircleHub): Router {
  const router = Router({ mergeParams: true })

  // POST /api/circles/:id/location
  router.post('/:id/location', requireNostrAuth, async (req: Request, res: Response) => {
    const { encrypted_payload } = req.body as { encrypted_payload?: string }
    const circleId = (req.params as { id: string }).id

    if (!encrypted_payload) {
      res.status(400).json({ code: 'INVALID_INPUT', message: 'encrypted_payload is required', retryable: false })
      return
    }

    const pool = getPool()
    try {
      const result = await pool.query(
        `INSERT INTO location_blobs (blob_id, circle_id, sender_pubkey, encrypted_payload, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes')
         RETURNING blob_id, sender_pubkey, encrypted_payload, sent_at`,
        [randomUUID(), circleId, req.nostrPubkey, encrypted_payload],
      )
      const blob = result.rows[0]
      circleHub.broadcast(circleId, {
        type: 'CIRCLE_LOCATION_BLOB',
        payload: { sender_pubkey: blob.sender_pubkey, encrypted_payload: blob.encrypted_payload, sent_at: blob.sent_at },
      })
      res.status(201).json(blob)
    } catch (err) {
      console.error('POST location blob error:', err)
      res.status(500).json({ code: 'DB_ERROR', message: 'Could not store location blob', retryable: true })
    }
  })

  // GET /api/circles/:id/location
  router.get('/:id/location', requireNostrAuth, async (req: Request, res: Response) => {
    const pool = getPool()
    try {
      const result = await pool.query(
        `SELECT sender_pubkey, encrypted_payload, sent_at
         FROM location_blobs
         WHERE circle_id = $1 AND expires_at > NOW()
         ORDER BY sent_at DESC`,
        [(req.params as { id: string }).id],
      )
      res.json({ blobs: result.rows })
    } catch (err) {
      console.error('GET location blobs error:', err)
      res.status(500).json({ code: 'DB_ERROR', message: 'Could not fetch blobs', retryable: true })
    }
  })

  return router
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd services/gateway && npx vitest run src/routes/__tests__/locationBlobs.test.ts
```

Expected: PASS (all 3 tests)

- [ ] **Step 6: Commit**

```bash
git add services/gateway/src/ws/circleHub.ts services/gateway/src/routes/locationBlobs.ts services/gateway/src/routes/__tests__/locationBlobs.test.ts
git commit -m "feat: add location blob routes and circle WebSocket hub"
```

---

## Task 7: Wire gateway

**Files:**
- Modify: `services/gateway/src/index.ts`

- [ ] **Step 1: Mount circle routes and circleHub in index.ts**

Replace the content of `services/gateway/src/index.ts` with:

```typescript
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { config } from './config'
import { eventsRouter } from './routes/events'
import { zapRouter } from './routes/zap'
import { circlesRouter } from './routes/circles'
import { createLocationBlobsRouter } from './routes/locationBlobs'
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
```

- [ ] **Step 2: Build gateway to confirm no TypeScript errors**

```bash
cd services/gateway && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add services/gateway/src/index.ts
git commit -m "feat: mount circle routes and circle WebSocket hub in gateway"
```

---

## Task 8: Client WS service + location publisher

**Files:**
- Create: `apps/pwa/src/services/circleWebSocket.ts`
- Create: `apps/pwa/src/services/locationPublisher.ts`

- [ ] **Step 1: Create circleWebSocket.ts**

Create `apps/pwa/src/services/circleWebSocket.ts`:

```typescript
import { useEffect, useRef } from 'react'
import { useAppDispatch } from '../store'
import { memberStatusUpdated, locationReceived } from '../store/circlesSlice'
import { decryptLocation, loadCircleKey } from './e2eeService'
import type { CircleWsMessage } from '../../../../shared/types'

const WS_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/circles`

export function useCircleWsConnection(circleId: string | null): void {
  const dispatch = useAppDispatch()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!circleId) return

    function connect(): void {
      const ws = new WebSocket(WS_BASE)
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join_circle', circle_id: circleId }))
      }

      ws.onmessage = async (event) => {
        try {
          const msg: CircleWsMessage = JSON.parse(event.data as string)

          if (msg.type === 'CIRCLE_LOCATION_BLOB') {
            const { sender_pubkey, encrypted_payload, sent_at } = msg.payload
            const key = await loadCircleKey(circleId!)
            if (!key) return
            const loc = await decryptLocation(key, encrypted_payload)
            if (loc) {
              dispatch(locationReceived({ pubkey: sender_pubkey, lat: loc.lat, lng: loc.lng, ts: sent_at }))
            }
          } else if (msg.type === 'CIRCLE_PRESENCE') {
            dispatch(memberStatusUpdated({ pubkey: msg.payload.sender_pubkey, status: msg.payload.mode }))
          }
        } catch {
          console.warn('[circle-ws] invalid message')
        }
      }

      ws.onclose = () => {
        reconnectTimer.current = setTimeout(connect, 3000)
      }

      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      wsRef.current?.close()
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [circleId, dispatch])
}
```

- [ ] **Step 2: Create locationPublisher.ts**

Create `apps/pwa/src/services/locationPublisher.ts`:

```typescript
import { loadCircleKey, encryptLocation } from './e2eeService'

const PUBLISH_INTERVAL_MS = 30_000

export interface LocationPublisher {
  stop: () => void
}

export function startLocationPublisher(
  circleId: string,
  nostrPubkey: string,
  authEventJson: string,
): LocationPublisher {
  let active = true

  async function publish(): Promise<void> {
    if (!active) return
    const key = await loadCircleKey(circleId)
    if (!key) return

    navigator.geolocation.getCurrentPosition(async (pos) => {
      if (!active) return
      const encrypted = await encryptLocation(key, pos.coords.latitude, pos.coords.longitude)
      try {
        await fetch(`/api/circles/${circleId}/location`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Nostr-Auth': authEventJson,
          },
          body: JSON.stringify({ sender_pubkey: nostrPubkey, encrypted_payload: encrypted }),
        })
      } catch {
        console.warn('[location-publisher] publish failed')
      }
    })
  }

  publish()
  const timer = setInterval(publish, PUBLISH_INTERVAL_MS)

  return {
    stop: () => {
      active = false
      clearInterval(timer)
    },
  }
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd apps/pwa && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/pwa/src/services/circleWebSocket.ts apps/pwa/src/services/locationPublisher.ts
git commit -m "feat: add circle WebSocket client and 30s location publisher"
```

---

## Task 9: useProximityAlerts hook (TDD)

**Files:**
- Create: `apps/pwa/src/hooks/useProximityAlerts.ts`
- Create: `apps/pwa/src/hooks/__tests__/useProximityAlerts.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/pwa/src/hooks/__tests__/useProximityAlerts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeProximityAlerts } from '../useProximityAlerts'
import type { CircleMember, SafetyEvent } from '../../../../../shared/types'

const member: CircleMember = {
  circle_id: 'c1',
  member_pubkey: 'bbb',
  alert_radius_km: 1,
  alert_severity: 'HIGH',
  joined_at: '',
}

const nearbyEvent: SafetyEvent = {
  event_id: 'e1',
  event_type: 'CIVIL_UNREST',
  severity: 'CRITICAL',
  title: 'Crisis Zone B',
  summary: null,
  location: { lat: -1.2921, lng: 36.8219, place_name: 'Nairobi CBD', county: 'Nairobi' },
  confidence: 0.9,
  source_count: 3,
  source_breakdown: {},
  is_active: true,
  started_at: '',
  last_updated: '',
  nostr_event_id: null,
  bitcoin_txid: null,
}

describe('computeProximityAlerts', () => {
  it('triggers alert when member is within radius of a high-severity event', () => {
    const memberLocation = { lat: -1.2925, lng: 36.8220 }
    const alerts = computeProximityAlerts([member], { [member.member_pubkey]: memberLocation }, [nearbyEvent])
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.member_pubkey).toBe('bbb')
    expect(alerts[0]!.event_id).toBe('e1')
  })

  it('does not trigger when member is outside radius', () => {
    const memberLocation = { lat: -2.0, lng: 37.5 }
    const alerts = computeProximityAlerts([member], { [member.member_pubkey]: memberLocation }, [nearbyEvent])
    expect(alerts).toHaveLength(0)
  })

  it('does not trigger when event severity is below member threshold', () => {
    const lowEvent = { ...nearbyEvent, severity: 'LOW' as const }
    const memberLocation = { lat: -1.2925, lng: 36.8220 }
    const alerts = computeProximityAlerts([member], { [member.member_pubkey]: memberLocation }, [lowEvent])
    expect(alerts).toHaveLength(0)
  })

  it('does not trigger for inactive events', () => {
    const inactiveEvent = { ...nearbyEvent, is_active: false }
    const memberLocation = { lat: -1.2925, lng: 36.8220 }
    const alerts = computeProximityAlerts([member], { [member.member_pubkey]: memberLocation }, [inactiveEvent])
    expect(alerts).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd apps/pwa && npx vitest run src/hooks/__tests__/useProximityAlerts.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement useProximityAlerts.ts**

Create `apps/pwa/src/hooks/useProximityAlerts.ts`:

```typescript
import { useEffect, useRef } from 'react'
import { useAppDispatch, useAppSelector } from '../store'
import { proximityAlertAdded } from '../store/circlesSlice'
import { haversineKm } from '../utils/geo'
import type { CircleMember, SafetyEvent, ProximityAlert, Severity } from '../../../../shared/types'
import { randomUUID } from '../utils/uuid'

const SEVERITY_RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }

export function computeProximityAlerts(
  members: CircleMember[],
  locations: Record<string, { lat: number; lng: number }>,
  events: SafetyEvent[],
): Omit<ProximityAlert, 'id'>[] {
  const alerts: Omit<ProximityAlert, 'id'>[] = []

  for (const member of members) {
    const loc = locations[member.member_pubkey]
    if (!loc) continue

    for (const event of events) {
      if (!event.is_active || !event.location) continue
      if (SEVERITY_RANK[event.severity] < SEVERITY_RANK[member.alert_severity]) continue

      const distKm = haversineKm(loc, { lat: event.location.lat, lng: event.location.lng })
      if (distKm <= member.alert_radius_km) {
        alerts.push({
          member_pubkey: member.member_pubkey,
          zone_name: event.title,
          event_id: event.event_id,
          severity: event.severity,
          triggered_at: new Date().toISOString(),
        })
      }
    }
  }

  return alerts
}

export function useProximityAlerts(): void {
  const dispatch = useAppDispatch()
  const activeCircleId = useAppSelector(s => s.circles.activeCircleId)
  const members = useAppSelector(s => activeCircleId ? (s.circles.members[activeCircleId] ?? []) : [])
  const locations = useAppSelector(s => s.circles.decryptedLocations)
  const existingAlertIds = useAppSelector(s => new Set(s.circles.proximityAlerts.map(a => `${a.member_pubkey}:${a.event_id}`)))
  const events = useAppSelector(s => s.events.items)
  const prevLocationsRef = useRef<typeof locations>({})

  useEffect(() => {
    if (locations === prevLocationsRef.current) return
    prevLocationsRef.current = locations

    const newAlerts = computeProximityAlerts(members, locations, events)
    for (const alert of newAlerts) {
      const key = `${alert.member_pubkey}:${alert.event_id}`
      if (!existingAlertIds.has(key)) {
        dispatch(proximityAlertAdded({ ...alert, id: randomUUID() }))
      }
    }
  }, [locations, members, events, dispatch, existingAlertIds])
}
```

- [ ] **Step 4: Create uuid utility**

Create `apps/pwa/src/utils/uuid.ts`:

```typescript
export function randomUUID(): string {
  return crypto.randomUUID()
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd apps/pwa && npx vitest run src/hooks/__tests__/useProximityAlerts.test.ts
```

Expected: PASS (all 4 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/pwa/src/hooks/useProximityAlerts.ts apps/pwa/src/hooks/__tests__/useProximityAlerts.test.ts apps/pwa/src/utils/uuid.ts
git commit -m "feat: add useProximityAlerts hook with client-side proximity detection"
```

---

## Task 10: MemberChip + X25519Badge components (TDD)

**Files:**
- Create: `apps/pwa/src/components/MemberChip.tsx`
- Create: `apps/pwa/src/components/__tests__/MemberChip.test.tsx`
- Create: `apps/pwa/src/components/X25519Badge.tsx`

- [ ] **Step 1: Write failing MemberChip test**

Create `apps/pwa/src/components/__tests__/MemberChip.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemberChip } from '../MemberChip'

describe('MemberChip', () => {
  it('renders truncated pubkey', () => {
    render(<MemberChip pubkey="npub1abc123def456" status="ONLINE" />)
    expect(screen.getByText(/npub1abc…/)).toBeInTheDocument()
  })

  it('applies online ring color for ONLINE status', () => {
    const { container } = render(<MemberChip pubkey="npub1abc123" status="ONLINE" />)
    const ring = container.querySelector('[data-status="ONLINE"]')
    expect(ring).toBeTruthy()
  })

  it('applies ghost ring color for GHOST status', () => {
    const { container } = render(<MemberChip pubkey="npub1abc123" status="GHOST" />)
    const ring = container.querySelector('[data-status="GHOST"]')
    expect(ring).toBeTruthy()
  })

  it('applies offline ring color for OFFLINE status', () => {
    const { container } = render(<MemberChip pubkey="npub1abc123" status="OFFLINE" />)
    const ring = container.querySelector('[data-status="OFFLINE"]')
    expect(ring).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd apps/pwa && npx vitest run src/components/__tests__/MemberChip.test.tsx
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement MemberChip.tsx**

Create `apps/pwa/src/components/MemberChip.tsx`:

```typescript
import type { MemberStatus } from '../../../../shared/types'

const RING_COLORS: Record<MemberStatus, string> = {
  ONLINE:  '#00E5FF',
  GHOST:   '#BB86FC',
  OFFLINE: '#2D3748',
}

const INNER_COLORS: Record<MemberStatus, string> = {
  ONLINE:  '#00E5FF',
  GHOST:   '#BB86FC',
  OFFLINE: '#2D3748',
}

interface MemberChipProps {
  pubkey: string
  status: MemberStatus
}

export function MemberChip({ pubkey, status }: MemberChipProps) {
  const truncated = pubkey.length > 10 ? `${pubkey.slice(0, 8)}…` : pubkey
  const ringColor = RING_COLORS[status]
  const innerColor = INNER_COLORS[status]

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      background: '#111827', border: '1px solid #1e2a3a', borderRadius: 20,
      padding: '3px 8px 3px 4px', cursor: 'pointer',
    }}>
      <div
        data-status={status}
        style={{
          width: 16, height: 16, borderRadius: '50%',
          border: `2px solid ${ringColor}`,
          boxShadow: status !== 'OFFLINE' ? `0 0 6px ${ringColor}66` : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: innerColor }} />
      </div>
      <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#a0aec0' }}>
        {truncated}
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Run MemberChip tests — expect pass**

```bash
cd apps/pwa && npx vitest run src/components/__tests__/MemberChip.test.tsx
```

Expected: PASS (all 4 tests)

- [ ] **Step 5: Create X25519Badge.tsx**

Create `apps/pwa/src/components/X25519Badge.tsx`:

```typescript
export function X25519Badge() {
  return (
    <div style={{
      position: 'absolute', bottom: 12, right: 12,
      display: 'flex', alignItems: 'center', gap: 6,
      background: 'rgba(5, 14, 20, 0.85)',
      border: '1px solid rgba(0, 229, 255, 0.3)',
      borderRadius: 6, padding: '5px 10px',
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%', background: '#00E5FF',
        animation: 'x25519-pulse 2s ease-in-out infinite',
      }} />
      <style>{`
        @keyframes x25519-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0,229,255,0.4); }
          50% { box-shadow: 0 0 0 5px rgba(0,229,255,0); }
        }
      `}</style>
      <span style={{
        fontFamily: "'Courier New', monospace", fontSize: 10,
        color: '#00E5FF', letterSpacing: '0.1em', textTransform: 'uppercase',
      }}>
        X25519 Active
      </span>
    </div>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/pwa/src/components/MemberChip.tsx apps/pwa/src/components/__tests__/MemberChip.test.tsx apps/pwa/src/components/X25519Badge.tsx
git commit -m "feat: add MemberChip status-ring pill and X25519Badge encryption indicator"
```

---

## Task 11: CircleMapLayer (TDD)

**Files:**
- Create: `apps/pwa/src/components/CircleMapLayer.tsx`
- Create: `apps/pwa/src/components/__tests__/CircleMapLayer.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/pwa/src/components/__tests__/CircleMapLayer.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CircleMapLayer } from '../CircleMapLayer'
import type { MemberStatus } from '../../../../../shared/types'

vi.mock('react-map-gl', () => ({
  Marker: ({ children, latitude, longitude }: { children: React.ReactNode; latitude: number; longitude: number }) => (
    <div data-testid="marker" data-lat={latitude} data-lng={longitude}>{children}</div>
  ),
}))

const locations = { aaa: { lat: -1.29, lng: 36.82, ts: '' } }
const statuses: Record<string, MemberStatus> = { aaa: 'ONLINE', bbb: 'GHOST' }

describe('CircleMapLayer', () => {
  it('renders a Marker for each ONLINE member', () => {
    render(<CircleMapLayer decryptedLocations={locations} memberStatuses={statuses} />)
    expect(screen.getAllByTestId('marker')).toHaveLength(1)
  })

  it('does not render Markers for GHOST or OFFLINE members', () => {
    const ghostLocations = { bbb: { lat: -1.3, lng: 36.9, ts: '' } }
    render(<CircleMapLayer decryptedLocations={ghostLocations} memberStatuses={statuses} />)
    expect(screen.queryAllByTestId('marker')).toHaveLength(0)
  })

  it('passes correct coordinates to Marker', () => {
    render(<CircleMapLayer decryptedLocations={locations} memberStatuses={statuses} />)
    const marker = screen.getByTestId('marker')
    expect(marker.getAttribute('data-lat')).toBe('-1.29')
    expect(marker.getAttribute('data-lng')).toBe('36.82')
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd apps/pwa && npx vitest run src/components/__tests__/CircleMapLayer.test.tsx
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement CircleMapLayer.tsx**

Create `apps/pwa/src/components/CircleMapLayer.tsx`:

```typescript
import { Marker } from 'react-map-gl'
import type { MemberStatus } from '../../../../shared/types'

interface DecryptedLocation { lat: number; lng: number; ts: string }

interface CircleMapLayerProps {
  decryptedLocations: Record<string, DecryptedLocation>
  memberStatuses: Record<string, MemberStatus>
}

export function CircleMapLayer({ decryptedLocations, memberStatuses }: CircleMapLayerProps) {
  return (
    <>
      {Object.entries(decryptedLocations).map(([pubkey, loc]) => {
        if (memberStatuses[pubkey] !== 'ONLINE') return null
        const truncated = pubkey.length > 10 ? `${pubkey.slice(0, 8)}…` : pubkey
        return (
          <Marker key={pubkey} latitude={loc.lat} longitude={loc.lng}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%',
                border: '2px solid #00E5FF',
                boxShadow: '0 0 12px rgba(0,229,255,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00E5FF' }} />
                <div style={{
                  position: 'absolute', inset: -4, borderRadius: '50%',
                  border: '1px solid rgba(0,229,255,0.2)',
                  animation: 'node-ping 1.8s ease-out infinite',
                }} />
              </div>
              <span style={{
                fontFamily: "'Courier New', monospace", fontSize: 9, color: '#a0aec0',
                background: 'rgba(13,17,24,0.8)', padding: '1px 4px', borderRadius: 3,
                whiteSpace: 'nowrap',
              }}>
                {truncated}
              </span>
            </div>
          </Marker>
        )
      })}
      <style>{`
        @keyframes node-ping {
          0%   { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.8); }
        }
      `}</style>
    </>
  )
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd apps/pwa && npx vitest run src/components/__tests__/CircleMapLayer.test.tsx
```

Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/components/CircleMapLayer.tsx apps/pwa/src/components/__tests__/CircleMapLayer.test.tsx
git commit -m "feat: add CircleMapLayer rendering ONLINE member nodes on Mapbox"
```

---

## Task 12: AlertBanner + ProximityAlertLog (TDD)

**Files:**
- Create: `apps/pwa/src/components/AlertBanner.tsx`
- Create: `apps/pwa/src/components/__tests__/AlertBanner.test.tsx`
- Create: `apps/pwa/src/components/ProximityAlertLog.tsx`
- Create: `apps/pwa/src/components/__tests__/ProximityAlertLog.test.tsx`

- [ ] **Step 1: Write AlertBanner tests**

Create `apps/pwa/src/components/__tests__/AlertBanner.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AlertBanner } from '../AlertBanner'
import type { ProximityAlert } from '../../../../../shared/types'

const alert: ProximityAlert = {
  id: 'a1', member_pubkey: 'npub1abc123def', zone_name: 'Crisis Zone B',
  event_id: 'e1', severity: 'HIGH', triggered_at: '',
}

describe('AlertBanner', () => {
  it('renders nothing when alert is null', () => {
    const { container } = render(<AlertBanner alert={null} onDismiss={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders alert text when alert is present', () => {
    render(<AlertBanner alert={alert} onDismiss={vi.fn()} />)
    expect(screen.getByText(/Crisis Zone B/)).toBeInTheDocument()
    expect(screen.getByText(/npub1abc…/)).toBeInTheDocument()
  })

  it('calls onDismiss when close button is clicked', () => {
    const onDismiss = vi.fn()
    render(<AlertBanner alert={alert} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onDismiss).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Implement AlertBanner.tsx**

Create `apps/pwa/src/components/AlertBanner.tsx`:

```typescript
import type { ProximityAlert } from '../../../../shared/types'

interface AlertBannerProps {
  alert: ProximityAlert | null
  onDismiss: () => void
}

export function AlertBanner({ alert, onDismiss }: AlertBannerProps) {
  if (!alert) return null

  const truncated = alert.member_pubkey.length > 10
    ? `${alert.member_pubkey.slice(0, 8)}…`
    : alert.member_pubkey

  return (
    <div style={{
      background: 'linear-gradient(90deg, rgba(0,229,255,0.07), rgba(187,134,252,0.07))',
      borderBottom: '1px solid rgba(0,229,255,0.25)',
      padding: '8px 16px',
      display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%', background: '#00E5FF',
        boxShadow: '0 0 8px #00E5FF', flexShrink: 0,
        animation: 'alert-pulse 1.2s ease-in-out infinite',
      }} />
      <style>{`
        @keyframes alert-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.7); }
        }
      `}</style>
      <span style={{
        fontFamily: "'Courier New', monospace", fontSize: 11,
        color: '#00E5FF', letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>
        Proximity Alert
      </span>
      <span style={{ color: '#a0aec0', fontSize: 12 }}>
        Member{' '}
        <strong style={{ color: '#e2e8f0' }}>{truncated}</strong>
        {' '}has entered{' '}
        <strong style={{ color: '#BB86FC' }}>{alert.zone_name}</strong>
      </span>
      <button
        onClick={onDismiss}
        style={{
          marginLeft: 'auto', background: 'none', border: 'none',
          color: '#4a5568', fontSize: 18, cursor: 'pointer', lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Write ProximityAlertLog tests**

Create `apps/pwa/src/components/__tests__/ProximityAlertLog.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProximityAlertLog } from '../ProximityAlertLog'
import type { ProximityAlert } from '../../../../../shared/types'

const alerts: ProximityAlert[] = [
  { id: 'a1', member_pubkey: 'npub1abc123', zone_name: 'Crisis Zone B', event_id: 'e1', severity: 'HIGH', triggered_at: '2026-05-03T02:14:00Z' },
  { id: 'a2', member_pubkey: 'npub1xyz789', zone_name: 'Flood Zone', event_id: 'e2', severity: 'CRITICAL', triggered_at: '2026-05-03T01:58:00Z' },
]

describe('ProximityAlertLog', () => {
  it('renders all alert entries', () => {
    render(<ProximityAlertLog alerts={alerts} />)
    expect(screen.getByText(/Crisis Zone B/)).toBeInTheDocument()
    expect(screen.getByText(/Flood Zone/)).toBeInTheDocument()
  })

  it('shows event count badge', () => {
    render(<ProximityAlertLog alerts={alerts} />)
    expect(screen.getByText('2 events')).toBeInTheDocument()
  })

  it('renders empty state when no alerts', () => {
    render(<ProximityAlertLog alerts={[]} />)
    expect(screen.getByText('No proximity alerts')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Implement ProximityAlertLog.tsx**

Create `apps/pwa/src/components/ProximityAlertLog.tsx`:

```typescript
import type { ProximityAlert, Severity } from '../../../../shared/types'

const SEV_STYLE: Record<Severity, { color: string; border: string; bg: string }> = {
  CRITICAL: { color: '#BB86FC', border: '#BB86FC44', bg: '#BB86FC11' },
  HIGH:     { color: '#BB86FC', border: '#BB86FC44', bg: '#BB86FC11' },
  MEDIUM:   { color: '#f6c90e', border: '#f6c90e44', bg: '#f6c90e11' },
  LOW:      { color: '#4a5568', border: '#2d3748',   bg: 'transparent' },
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  catch { return '--:--' }
}

interface ProximityAlertLogProps {
  alerts: ProximityAlert[]
}

export function ProximityAlertLog({ alerts }: ProximityAlertLogProps) {
  return (
    <div style={{
      height: '25%', flexShrink: 0, borderTop: '1px solid #1a2035',
      background: '#08090f', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 16px', borderBottom: '1px solid #111827', flexShrink: 0,
      }}>
        <span style={{
          fontFamily: "'Courier New', monospace", fontSize: 9,
          letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4a5568',
        }}>
          Proximity Alert Log
        </span>
        {alerts.length > 0 && (
          <span style={{
            background: 'rgba(187,134,252,0.13)', color: '#BB86FC',
            borderRadius: 10, fontSize: 9, padding: '1px 6px',
            fontFamily: "'Courier New', monospace",
          }}>
            {alerts.length} events
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {alerts.length === 0 && (
          <div style={{ padding: '12px 16px', color: '#2d3748', fontSize: 11 }}>
            No proximity alerts
          </div>
        )}
        {alerts.map(alert => {
          const sev = SEV_STYLE[alert.severity]
          const truncated = alert.member_pubkey.length > 10
            ? `${alert.member_pubkey.slice(0, 8)}…`
            : alert.member_pubkey
          return (
            <div key={alert.id} style={{
              display: 'flex', alignItems: 'baseline', gap: 10,
              padding: '5px 16px', borderBottom: '1px solid #0f1420',
            }}>
              <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#2d3748', flexShrink: 0, width: 40 }}>
                {formatTime(alert.triggered_at)}
              </span>
              <span style={{ fontSize: 11, color: '#718096', flex: 1 }}>
                Member{' '}
                <strong style={{ color: '#a0aec0' }}>{truncated}</strong>
                {' '}entered{' '}
                <span style={{ color: '#BB86FC' }}>{alert.zone_name}</span>
              </span>
              <span style={{
                fontFamily: "'Courier New', monospace", fontSize: 9,
                padding: '1px 5px', borderRadius: 3,
                color: sev.color, border: `1px solid ${sev.border}`, background: sev.bg,
                flexShrink: 0,
              }}>
                {alert.severity}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run all four tests**

```bash
cd apps/pwa && npx vitest run src/components/__tests__/AlertBanner.test.tsx src/components/__tests__/ProximityAlertLog.test.tsx
```

Expected: PASS (all 6 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/pwa/src/components/AlertBanner.tsx apps/pwa/src/components/__tests__/AlertBanner.test.tsx apps/pwa/src/components/ProximityAlertLog.tsx apps/pwa/src/components/__tests__/ProximityAlertLog.test.tsx
git commit -m "feat: add AlertBanner and ProximityAlertLog components"
```

---

## Task 13: InviteModal (TDD)

**Files:**
- Create: `apps/pwa/src/components/InviteModal.tsx`
- Create: `apps/pwa/src/components/__tests__/InviteModal.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/pwa/src/components/__tests__/InviteModal.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InviteModal } from '../InviteModal'

describe('InviteModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <InviteModal isOpen={false} inviteString="" onClose={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('displays invite string in a readonly input', () => {
    render(<InviteModal isOpen={true} inviteString="nostr:abc123" onClose={vi.fn()} />)
    const input = screen.getByDisplayValue('nostr:abc123') as HTMLInputElement
    expect(input.readOnly).toBe(true)
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<InviteModal isOpen={true} inviteString="nostr:abc" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd apps/pwa && npx vitest run src/components/__tests__/InviteModal.test.tsx
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement InviteModal.tsx**

Create `apps/pwa/src/components/InviteModal.tsx`:

```typescript
interface InviteModalProps {
  isOpen: boolean
  inviteString: string
  onClose: () => void
}

export function InviteModal({ isOpen, inviteString, onClose }: InviteModalProps) {
  if (!isOpen) return null

  function copyToClipboard() {
    navigator.clipboard.writeText(inviteString).catch(() => {})
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: 'rgba(5,7,9,0.85)', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#0d1118', border: '1px solid #1a2035', borderRadius: 8,
        padding: 24, width: 440, maxWidth: '90vw',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#BB86FC' }}>
            Invite via Nostr
          </span>
          <button
            aria-label="close"
            onClick={onClose}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#4a5568', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <p style={{ fontSize: 12, color: '#718096', marginBottom: 12 }}>
          Share this invite string with the person you want to add. It expires in 24 hours.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            readOnly
            value={inviteString}
            style={{
              flex: 1, background: '#050709', border: '1px solid #1a2035', borderRadius: 4,
              padding: '8px 10px', color: '#a0aec0', fontFamily: "'Courier New', monospace", fontSize: 11,
              outline: 'none',
            }}
          />
          <button
            onClick={copyToClipboard}
            style={{
              background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.3)',
              borderRadius: 4, padding: '8px 14px', color: '#00E5FF',
              fontFamily: "'Courier New', monospace", fontSize: 11, cursor: 'pointer',
              letterSpacing: '0.05em',
            }}
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd apps/pwa && npx vitest run src/components/__tests__/InviteModal.test.tsx
```

Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/components/InviteModal.tsx apps/pwa/src/components/__tests__/InviteModal.test.tsx
git commit -m "feat: add InviteModal for Nostr circle invite generation"
```

---

## Task 14: CircleSidebar (TDD)

**Files:**
- Create: `apps/pwa/src/components/CircleSidebar.tsx`
- Create: `apps/pwa/src/components/__tests__/CircleSidebar.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/pwa/src/components/__tests__/CircleSidebar.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CircleSidebar } from '../CircleSidebar'
import type { Circle, CircleMember, MemberStatus } from '../../../../../shared/types'

const circle: Circle = { circle_id: 'c1', owner_pubkey: 'aaa', name: 'Wanga Family', created_at: '' }

const members: CircleMember[] = [
  { circle_id: 'c1', member_pubkey: 'npub1aaabbb', alert_radius_km: 1, alert_severity: 'HIGH', joined_at: '' },
  { circle_id: 'c1', member_pubkey: 'npub1cccdd', alert_radius_km: 2, alert_severity: 'MEDIUM', joined_at: '' },
]

const statuses: Record<string, MemberStatus> = { 'npub1aaabbb': 'ONLINE', 'npub1cccdd': 'GHOST' }

describe('CircleSidebar', () => {
  it('renders circle name', () => {
    render(<CircleSidebar circle={circle} members={members} memberStatuses={statuses} onInvite={vi.fn()} onLeave={vi.fn()} />)
    expect(screen.getByText('Wanga Family')).toBeInTheDocument()
  })

  it('renders a MemberChip for each member', () => {
    render(<CircleSidebar circle={circle} members={members} memberStatuses={statuses} onInvite={vi.fn()} onLeave={vi.fn()} />)
    expect(screen.getAllByText(/npub1/)).toHaveLength(members.length * 2)
  })

  it('calls onInvite when invite button is clicked', () => {
    const onInvite = vi.fn()
    render(<CircleSidebar circle={circle} members={members} memberStatuses={statuses} onInvite={onInvite} onLeave={vi.fn()} />)
    fireEvent.click(screen.getByText(/Invite via Nostr/i))
    expect(onInvite).toHaveBeenCalled()
  })

  it('calls onLeave when Leave Circle button is clicked', () => {
    const onLeave = vi.fn()
    render(<CircleSidebar circle={circle} members={members} memberStatuses={statuses} onInvite={vi.fn()} onLeave={onLeave} />)
    fireEvent.click(screen.getByText(/Leave Circle/i))
    expect(onLeave).toHaveBeenCalled()
  })

  it('shows E2EE indicator text', () => {
    render(<CircleSidebar circle={circle} members={members} memberStatuses={statuses} onInvite={vi.fn()} onLeave={vi.fn()} />)
    expect(screen.getByText(/Active X25519 Encryption/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd apps/pwa && npx vitest run src/components/__tests__/CircleSidebar.test.tsx
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement CircleSidebar.tsx**

Create `apps/pwa/src/components/CircleSidebar.tsx`:

```typescript
import { MemberChip } from './MemberChip'
import type { Circle, CircleMember, MemberStatus } from '../../../../shared/types'

interface CircleSidebarProps {
  circle: Circle
  members: CircleMember[]
  memberStatuses: Record<string, MemberStatus>
  onInvite: () => void
  onLeave: () => void
}

const STATUS_LABEL: Record<MemberStatus, string> = {
  ONLINE:  '● Sharing location',
  GHOST:   '◐ Ghost mode',
  OFFLINE: '○ Offline',
}

const STATUS_COLOR: Record<MemberStatus, string> = {
  ONLINE:  'rgba(0,229,255,0.55)',
  GHOST:   'rgba(187,134,252,0.55)',
  OFFLINE: '#4a5568',
}

const AVATAR_COLOR: Record<MemberStatus, string> = {
  ONLINE:  '#00E5FF',
  GHOST:   '#BB86FC',
  OFFLINE: '#2D3748',
}

export function CircleSidebar({ circle, members, memberStatuses, onInvite, onLeave }: CircleSidebarProps) {
  return (
    <aside style={{
      width: 256, flexShrink: 0, background: '#0d1118',
      borderRight: '1px solid #1a2035', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Circle header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #1a2035' }}>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#BB86FC', marginBottom: 4 }}>
          Family Circle
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{circle.name}</div>
        <div style={{ fontSize: 11, color: '#4a5568', marginTop: 2, fontFamily: "'Courier New', monospace" }}>
          {members.length} members · {circle.circle_id.slice(0, 8)}…
        </div>
      </div>

      {/* Member chips */}
      <div style={{ padding: '10px 16px 6px', display: 'flex', flexWrap: 'wrap', gap: 6, borderBottom: '1px solid #1a2035' }}>
        {members.map(m => (
          <MemberChip key={m.member_pubkey} pubkey={m.member_pubkey} status={memberStatuses[m.member_pubkey] ?? 'OFFLINE'} />
        ))}
      </div>

      {/* Member list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4a5568', padding: '6px 16px 4px' }}>
          Members
        </div>
        {members.map(m => {
          const status = memberStatuses[m.member_pubkey] ?? 'OFFLINE'
          const initial = m.member_pubkey.slice(-1).toUpperCase()
          const avatarColor = AVATAR_COLOR[status]
          return (
            <div key={m.member_pubkey} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                border: `2px solid ${avatarColor}`, color: avatarColor,
                background: `${avatarColor}0d`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, flexShrink: 0,
              }}>
                {initial}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: '#cbd5e0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.member_pubkey}
                </div>
                <div style={{ fontSize: 10, color: STATUS_COLOR[status], marginTop: 1 }}>
                  {STATUS_LABEL[status]}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* E2EE widget */}
      <div style={{
        margin: '8px 16px', background: '#050e14',
        border: '1px solid rgba(0,229,255,0.15)', borderRadius: 6, padding: '8px 10px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%', background: '#00E5FF', flexShrink: 0,
          animation: 'e2ee-pulse 2s ease-in-out infinite',
        }} />
        <style>{`
          @keyframes e2ee-pulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(0,229,255,0.4); }
            50% { box-shadow: 0 0 0 5px rgba(0,229,255,0); }
          }
        `}</style>
        <div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#00E5FF' }}>
            Active X25519 Encryption
          </div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: '#2d4a5a', marginTop: 1 }}>
            AES-256-GCM · server sees 0 coordinates
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid #1a2035', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          onClick={onInvite}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(0,229,255,0.07)', border: '1px solid rgba(0,229,255,0.2)',
            borderRadius: 6, padding: '8px 12px', color: '#00E5FF',
            fontFamily: "'Courier New', monospace", fontSize: 11, letterSpacing: '0.05em',
            cursor: 'pointer', width: '100%',
          }}
        >
          <span>⚡</span>
          <span>Invite via Nostr</span>
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            background: 'transparent', border: '1px solid #1a2035', borderRadius: 6, padding: 6,
            color: '#4a5568', fontSize: 11, cursor: 'pointer',
          }}>
            🔑 Manage Keys
          </button>
          <button
            onClick={onLeave}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              background: 'transparent', border: '1px solid #1a2035', borderRadius: 6, padding: 6,
              color: '#4a5568', fontSize: 11, cursor: 'pointer',
            }}
          >
            ⬡ Leave Circle
          </button>
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd apps/pwa && npx vitest run src/components/__tests__/CircleSidebar.test.tsx
```

Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/components/CircleSidebar.tsx apps/pwa/src/components/__tests__/CircleSidebar.test.tsx
git commit -m "feat: add CircleSidebar with member chips, E2EE widget, and action buttons"
```

---

## Task 15: FamilyCircleDashboard + full wire-up

**Files:**
- Create: `apps/pwa/src/components/FamilyCircleDashboard.tsx`
- Create: `apps/pwa/src/components/__tests__/FamilyCircleDashboard.test.tsx`
- Modify: `apps/pwa/src/store/index.ts`
- Modify: `apps/pwa/src/App.tsx`

- [ ] **Step 1: Add circlesReducer to store**

Edit `apps/pwa/src/store/index.ts` — add the import and reducer:

```typescript
import { configureStore } from '@reduxjs/toolkit'
import eventsReducer from './eventsSlice'
import acousticReducer from './acousticSlice'
import circlesReducer from './circlesSlice'
import { useSelector, TypedUseSelectorHook, useDispatch } from 'react-redux'

export const store = configureStore({
  reducer: {
    events: eventsReducer,
    acoustic: acousticReducer,
    circles: circlesReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
export const useAppDispatch = () => useDispatch<AppDispatch>()
```

- [ ] **Step 2: Write failing FamilyCircleDashboard tests**

Create `apps/pwa/src/components/__tests__/FamilyCircleDashboard.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import circlesReducer, { circleLoaded } from '../../store/circlesSlice'
import eventsReducer from '../../store/eventsSlice'
import acousticReducer from '../../store/acousticSlice'
import { FamilyCircleDashboard } from '../FamilyCircleDashboard'
import type { Circle, CircleMember } from '../../../../../shared/types'

vi.mock('../CircleMapLayer', () => ({
  CircleMapLayer: () => <div data-testid="circle-map-layer" />,
}))
vi.mock('react-map-gl', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="mapbox">{children}</div>,
  Marker: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const circle: Circle = { circle_id: 'c1', owner_pubkey: 'aaa', name: 'Wanga Family', created_at: '' }
const members: CircleMember[] = [
  { circle_id: 'c1', member_pubkey: 'npub1aaa', alert_radius_km: 1, alert_severity: 'HIGH', joined_at: '' },
]

function makeStore() {
  const store = configureStore({ reducer: { circles: circlesReducer, events: eventsReducer, acoustic: acousticReducer } })
  store.dispatch(circleLoaded({ circle, members }))
  return store
}

describe('FamilyCircleDashboard', () => {
  it('renders circle name in sidebar', () => {
    render(<Provider store={makeStore()}><FamilyCircleDashboard /></Provider>)
    expect(screen.getByText('Wanga Family')).toBeInTheDocument()
  })

  it('renders the map area', () => {
    render(<Provider store={makeStore()}><FamilyCircleDashboard /></Provider>)
    expect(screen.getByTestId('mapbox')).toBeInTheDocument()
  })

  it('renders ProximityAlertLog', () => {
    render(<Provider store={makeStore()}><FamilyCircleDashboard /></Provider>)
    expect(screen.getByText(/Proximity Alert Log/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run tests — expect failure**

```bash
cd apps/pwa && npx vitest run src/components/__tests__/FamilyCircleDashboard.test.tsx
```

Expected: FAIL — module not found

- [ ] **Step 4: Implement FamilyCircleDashboard.tsx**

Create `apps/pwa/src/components/FamilyCircleDashboard.tsx`:

```typescript
import { useEffect, useRef, useCallback } from 'react'
import Map from 'react-map-gl'
import { useAppSelector, useAppDispatch } from '../store'
import { activeAlertDismissed } from '../store/circlesSlice'
import { CircleSidebar } from './CircleSidebar'
import { CircleMapLayer } from './CircleMapLayer'
import { AlertBanner } from './AlertBanner'
import { ProximityAlertLog } from './ProximityAlertLog'
import { InviteModal } from './InviteModal'
import { X25519Badge } from './X25519Badge'
import { useCircleWsConnection } from '../services/circleWebSocket'
import { useProximityAlerts } from '../hooks/useProximityAlerts'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useState } from 'react'

const MAPBOX_TOKEN = import.meta.env['VITE_MAPBOX_TOKEN'] as string

export function FamilyCircleDashboard() {
  const dispatch = useAppDispatch()
  const activeCircleId = useAppSelector(s => s.circles.activeCircleId)
  const circles = useAppSelector(s => s.circles.circles)
  const members = useAppSelector(s => activeCircleId ? (s.circles.members[activeCircleId] ?? []) : [])
  const memberStatuses = useAppSelector(s => s.circles.memberStatuses)
  const decryptedLocations = useAppSelector(s => s.circles.decryptedLocations)
  const proximityAlerts = useAppSelector(s => s.circles.proximityAlerts)
  const activeAlert = useAppSelector(s => s.circles.activeAlert)

  const activeCircle = circles.find(c => c.circle_id === activeCircleId) ?? null
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteString, setInviteString] = useState('')

  useCircleWsConnection(activeCircleId)
  useProximityAlerts()

  const handleInvite = useCallback(() => {
    setInviteString(`sentinelmesh:invite:${activeCircleId}:${Date.now()}`)
    setInviteOpen(true)
  }, [activeCircleId])

  const handleLeave = useCallback(() => {
    if (window.confirm('Leave this circle? Your local circle key will be removed.')) {
      dispatch({ type: 'circles/circleLeft' })
    }
  }, [dispatch])

  const handleDismissAlert = useCallback(() => dispatch(activeAlertDismissed()), [dispatch])

  if (!activeCircle) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#4a5568', fontFamily: "'Courier New', monospace", fontSize: 12 }}>
        No active circle — create or join a circle to begin.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0B0E14' }}>
      <AlertBanner alert={activeAlert} onDismiss={handleDismissAlert} />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <CircleSidebar
          circle={activeCircle}
          members={members}
          memberStatuses={memberStatuses}
          onInvite={handleInvite}
          onLeave={handleLeave}
        />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Map
              mapboxAccessToken={MAPBOX_TOKEN}
              initialViewState={{ longitude: 36.8219, latitude: -1.2921, zoom: 12 }}
              style={{ width: '100%', height: '100%' }}
              mapStyle="mapbox://styles/mapbox/dark-v11"
            >
              <CircleMapLayer decryptedLocations={decryptedLocations} memberStatuses={memberStatuses} />
            </Map>
            <X25519Badge />
          </div>

          <ProximityAlertLog alerts={proximityAlerts} />
        </div>
      </div>

      <InviteModal isOpen={inviteOpen} inviteString={inviteString} onClose={() => setInviteOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 5: Run FamilyCircleDashboard tests — expect pass**

```bash
cd apps/pwa && npx vitest run src/components/__tests__/FamilyCircleDashboard.test.tsx
```

Expected: PASS (all 3 tests)

- [ ] **Step 6: Add Family Circles tab to App.tsx**

Replace `apps/pwa/src/App.tsx` with:

```typescript
import { useEffect, useCallback, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import SafetyMap from './components/SafetyMap'
import { AcousticAlert } from './components/AcousticAlert'
import { FamilyCircleDashboard } from './components/FamilyCircleDashboard'
import { useWsConnection } from './services/websocket'
import { AudioCapture } from './services/audioCapture'
import { AcousticDetectionService } from './services/acousticDetectionService'
import { autoSubmitAcousticReport } from './services/reportAutoSubmit'
import { detectionReceived, alertDismissed, detectionStarted, detectionStopped } from './store/acousticSlice'
import type { RootState } from './store'

type View = 'map' | 'circles'

export default function App() {
  useWsConnection()
  const dispatch = useDispatch()
  const currentAlert = useSelector((s: RootState) => s.acoustic.currentAlert)
  const [view, setView] = useState<View>('map')

  const handleDismiss = useCallback(() => dispatch(alertDismissed()), [dispatch])

  useEffect(() => {
    let capture: AudioCapture | null = null
    let detector: AcousticDetectionService | null = null

    async function start() {
      detector = new AcousticDetectionService((detection) => {
        dispatch(detectionReceived(detection))
        navigator.geolocation?.getCurrentPosition((pos) => {
          autoSubmitAcousticReport(detection, { lat: pos.coords.latitude, lng: pos.coords.longitude })
        })
      })
      try {
        await detector.init()
        capture = new AudioCapture((samples) => detector?.processWindow(samples))
        await capture.start()
        dispatch(detectionStarted())
      } catch (err) {
        console.warn('[acoustic] detection unavailable:', err)
      }
    }

    start()
    return () => { capture?.stop(); dispatch(detectionStopped()) }
  }, [dispatch])

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', background: '#0B0E14', borderBottom: '1px solid #1a2035', flexShrink: 0 }}>
        {(['map', 'circles'] as View[]).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              padding: '8px 20px',
              background: 'none', border: 'none',
              borderBottom: view === v ? '2px solid #00E5FF' : '2px solid transparent',
              color: view === v ? '#00E5FF' : '#4a5568',
              fontFamily: "'Courier New', monospace", fontSize: 11,
              letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
            }}
          >
            {v === 'map' ? 'Safety Map' : 'Family Circles'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <AcousticAlert detection={currentAlert} onDismiss={handleDismiss} />
        {view === 'map' && <SafetyMap />}
        {view === 'circles' && <FamilyCircleDashboard />}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: TypeScript check**

```bash
cd apps/pwa && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 8: Run full test suite**

```bash
cd apps/pwa && npx vitest run
```

Expected: all tests pass, no regressions

- [ ] **Step 9: Commit**

```bash
git add apps/pwa/src/components/FamilyCircleDashboard.tsx apps/pwa/src/components/__tests__/FamilyCircleDashboard.test.tsx apps/pwa/src/store/index.ts apps/pwa/src/App.tsx
git commit -m "feat: add FamilyCircleDashboard and wire Phase 3 into App"
```

---

## Self-Review Checklist

Spec requirement → task coverage:

| Spec requirement | Task |
|---|---|
| Three-panel layout (sidebar + map + log) | Task 15 (FamilyCircleDashboard) |
| Fixed w-64 sidebar | Task 14 (CircleSidebar) |
| Member chips row | Task 14 |
| Member list with status rings | Tasks 10, 14 |
| Invite via Nostr button + modal | Tasks 13, 14 |
| Manage Keys / Leave Circle | Task 14 |
| E2EE widget with pulse | Task 14 |
| Alert Banner (conditional) | Task 12 |
| Map with member nodes | Tasks 11, 15 |
| X25519 Active badge | Task 10 |
| Proximity Alert Log (h-1/4) | Tasks 12, 15 |
| X25519 key exchange / wrapping | Task 2 |
| AES-256-GCM encrypt/decrypt | Task 2 |
| Circle key in localStorage | Task 2 |
| Redux circlesSlice | Task 3 |
| Nostr auth middleware | Task 4 |
| Circle CRUD gateway routes | Task 5 |
| Location blob routes + broadcast | Task 6 |
| Circle WebSocket hub (gateway) | Task 6 |
| Circle WS client (PWA) | Task 8 |
| 30 s location publisher | Task 8 |
| Client-side proximity detection | Task 9 |
| DB schema — no migrations needed | Documented in spec |
| `haversineKm` for distance | Task 1 |
| Shared types | Task 1 |
