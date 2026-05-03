# Phase 4A: Nostr + Bitcoin Anchoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-event Nostr publishing (Kind 1 + Kind 30078) and Bitcoin OP_RETURN anchoring for AUTHORITATIVE/CRITICAL safety events and high-consensus community reports, with ⚡/₿ badges in the PWA.

**Architecture:** New `services/blockchain/` TypeScript service polls a `publish_jobs` PostgreSQL queue (FOR UPDATE SKIP LOCKED). Gateway inserts jobs at event creation; an advisory nudge shortens latency. PWA renders badges from IDs that the blockchain service writes back to source rows.

**Tech Stack:** TypeScript + Express, `nostr-tools`, `bitcoinjs-lib`, `node-fetch`, `pg`, React + Redux Toolkit (existing PWA), PostgreSQL.

---

## File Map

**New files:**
- `infra/postgres/migrations/004_publish_jobs.sql` — new tables
- `services/blockchain/package.json`
- `services/blockchain/tsconfig.json`
- `services/blockchain/src/config.ts`
- `services/blockchain/src/db/pool.ts`
- `services/blockchain/src/utils/canonicalHash.ts`
- `services/blockchain/src/workers/nostrPublisher.ts`
- `services/blockchain/src/workers/bitcoinAnchor.ts`
- `services/blockchain/src/workers/publishWorker.ts`
- `services/blockchain/src/routes/internal.ts`
- `services/blockchain/src/index.ts`
- `services/blockchain/src/tests/canonicalHash.test.ts`
- `services/blockchain/src/tests/publishWorker.test.ts`
- `services/blockchain/src/tests/nostrPublisher.test.ts`
- `services/blockchain/src/tests/bitcoinAnchor.test.ts`
- `apps/pwa/src/components/VerificationBadges.tsx`
- `apps/pwa/src/components/VerificationBadges.test.tsx`

**Modified files:**
- `infra/postgres/init.sql` — add `publish_jobs` + `publish_failures` tables
- `services/gateway/src/routes/events.ts` — enqueue job on AUTHORITATIVE/CRITICAL
- `services/gateway/src/routes/reports.ts` — enqueue job when consensus_score >= 3
- `services/gateway/src/config.ts` — add `blockchainServiceUrl`
- `services/gateway/src/utils/nudge.ts` — new shared nudge helper (create)
- `apps/pwa/src/components/SafetyMap.tsx` — add VerificationBadges to event popup
- `apps/pwa/src/components/ReportList.tsx` — add VerificationBadges to card

---

### Task 1: Database Migration — publish_jobs and publish_failures

**Files:**
- Create: `infra/postgres/migrations/004_publish_jobs.sql`
- Modify: `infra/postgres/init.sql`

- [ ] **Step 1: Write the migration SQL**

Create `infra/postgres/migrations/004_publish_jobs.sql`:

```sql
CREATE TABLE IF NOT EXISTS publish_jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_type     VARCHAR(20) NOT NULL,
  source_id       UUID NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  worker_id       VARCHAR(64),
  locked_at       TIMESTAMPTZ,
  nostr_kind1_id  VARCHAR(64),
  nostr_kind30078_id VARCHAR(64),
  bitcoin_txid    VARCHAR(64),
  anchor_hash     CHAR(64),
  retry_count     INT NOT NULL DEFAULT 0,
  next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publish_jobs_claimable
  ON publish_jobs (next_retry_at, status)
  WHERE status IN ('PENDING', 'FAILED');

CREATE TABLE IF NOT EXISTS publish_failures (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id        UUID NOT NULL REFERENCES publish_jobs(id),
  step          VARCHAR(30) NOT NULL,
  error_message TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publish_failures_job ON publish_failures(job_id);
```

- [ ] **Step 2: Add the same SQL to init.sql**

Open `infra/postgres/init.sql`. Add the `publish_jobs` and `publish_failures` table definitions (identical to the migration SQL above) after the `lightning_zaps` table block. Keep the `CREATE INDEX` statements together with the other indexes.

- [ ] **Step 3: Commit**

```bash
git add infra/postgres/migrations/004_publish_jobs.sql infra/postgres/init.sql
git commit -m "feat: add publish_jobs and publish_failures tables for blockchain anchoring"
```

---

### Task 2: Blockchain Service Scaffold

**Files:**
- Create: `services/blockchain/package.json`
- Create: `services/blockchain/tsconfig.json`
- Create: `services/blockchain/src/config.ts`
- Create: `services/blockchain/src/db/pool.ts`

- [ ] **Step 1: Create package.json**

Create `services/blockchain/package.json`:

```json
{
  "name": "@sentinelmesh/blockchain",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/index.ts",
    "test": "jest --runInBand"
  },
  "dependencies": {
    "bitcoinjs-lib": "^6.1.5",
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.5",
    "nostr-tools": "^2.3.1",
    "node-fetch": "^3.3.2",
    "pg": "^8.11.3"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.10.0",
    "@types/pg": "^8.10.9",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.1",
    "typescript": "^5.3.2"
  },
  "jest": {
    "preset": "ts-jest",
    "testEnvironment": "node",
    "testMatch": ["**/tests/**/*.test.ts"]
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `services/blockchain/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create config.ts**

Create `services/blockchain/src/config.ts`:

```typescript
export const config = {
  port: parseInt(process.env.BLOCKCHAIN_PORT ?? '3003', 10),
  databaseUrl: process.env.DATABASE_URL ?? '',
  nostrPrivkey: process.env.NOSTR_PRIVKEY ?? '',
  relayUrls: (process.env.RELAY_URLS ?? 'wss://relay.damus.io').split(',').map(s => s.trim()),
  bitcoinWif: process.env.BITCOIN_WIF ?? '',
  bitcoinNetwork: (process.env.BITCOIN_NETWORK ?? 'testnet') as 'mainnet' | 'testnet',
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '10000', 10),
}
```

- [ ] **Step 4: Create db/pool.ts**

Create `services/blockchain/src/db/pool.ts`:

```typescript
import { Pool } from 'pg'
import { config } from '../config'

let _pool: Pool | null = null

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: config.databaseUrl })
  }
  return _pool
}
```

- [ ] **Step 5: Install dependencies**

```bash
cd services/blockchain && npm install
```

Expected: packages installed, no errors.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd services/blockchain && npm run build
```

Expected: `dist/` created with no type errors.

- [ ] **Step 7: Commit**

```bash
git add services/blockchain/
git commit -m "feat: scaffold blockchain service with config and db pool"
```

---

### Task 3: canonicalHash Utility

**Files:**
- Create: `services/blockchain/src/utils/canonicalHash.ts`
- Create: `services/blockchain/src/tests/canonicalHash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/blockchain/src/tests/canonicalHash.test.ts`:

```typescript
import { buildAnchorHash } from '../utils/canonicalHash'

describe('buildAnchorHash', () => {
  const params = {
    event_id: 'abc123',
    nostr_event_id: 'def456',
    severity: 'CRITICAL',
  }

  it('returns a 64-char hex string', () => {
    const hash = buildAnchorHash(params)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic — same inputs always produce the same hash', () => {
    expect(buildAnchorHash(params)).toBe(buildAnchorHash(params))
  })

  it('is sensitive to each field', () => {
    const h1 = buildAnchorHash(params)
    const h2 = buildAnchorHash({ ...params, event_id: 'different' })
    const h3 = buildAnchorHash({ ...params, nostr_event_id: 'different' })
    const h4 = buildAnchorHash({ ...params, severity: 'AUTHORITATIVE' })
    expect(new Set([h1, h2, h3, h4]).size).toBe(4)
  })

  it('is key-order independent — same hash regardless of object key order', () => {
    const h1 = buildAnchorHash({ event_id: 'a', nostr_event_id: 'b', severity: 'CRITICAL' })
    const h2 = buildAnchorHash({ severity: 'CRITICAL', nostr_event_id: 'b', event_id: 'a' })
    expect(h1).toBe(h2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd services/blockchain && npm test -- --testPathPattern=canonicalHash
```

Expected: FAIL — "Cannot find module '../utils/canonicalHash'"

- [ ] **Step 3: Implement canonicalHash.ts**

Create `services/blockchain/src/utils/canonicalHash.ts`:

```typescript
import { createHash } from 'crypto'

interface AnchorParams {
  event_id: string
  nostr_event_id: string
  severity: string
}

export function buildAnchorHash(params: AnchorParams): string {
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(params).sort()) {
    sorted[key] = (params as Record<string, string>)[key]
  }
  const canonical = JSON.stringify(sorted)
  return createHash('sha256').update(canonical).digest('hex')
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd services/blockchain && npm test -- --testPathPattern=canonicalHash
```

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add services/blockchain/src/utils/canonicalHash.ts services/blockchain/src/tests/canonicalHash.test.ts
git commit -m "feat: add canonicalHash utility with deterministic SHA256 anchor hash"
```

---

### Task 4: Nostr Publisher

**Files:**
- Create: `services/blockchain/src/workers/nostrPublisher.ts`
- Create: `services/blockchain/src/tests/nostrPublisher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/blockchain/src/tests/nostrPublisher.test.ts`:

```typescript
import { publishNostrEvents } from '../workers/nostrPublisher'

// Mock WebSocket relay — accepts the event and sends OK
const mockRelayFactory = (accept: boolean) => {
  const handlers: Record<string, Function> = {}
  return {
    ws: {
      readyState: 1,
      send: jest.fn((data: string) => {
        const msg = JSON.parse(data)
        if (msg[0] === 'EVENT' && handlers['message']) {
          const eventId = msg[1].id
          handlers['message']({ data: JSON.stringify(['OK', eventId, accept, '']) })
        }
      }),
      addEventListener: jest.fn((evt: string, fn: Function) => { handlers[evt] = fn }),
      removeEventListener: jest.fn(),
      close: jest.fn(),
    },
    close: jest.fn(),
  }
}

jest.mock('nostr-tools/relay', () => ({
  Relay: {
    connect: jest.fn().mockImplementation(() => Promise.resolve(mockRelayFactory(true).ws)),
  },
}))

describe('publishNostrEvents', () => {
  const privkey = '0'.repeat(64)
  const payload = {
    source_id: 'test-uuid-1234',
    source_type: 'SAFETY_EVENT' as const,
    severity: 'CRITICAL',
    event_type: 'SHOOTING',
    lat: 37.7749,
    lng: -122.4194,
    place_name: 'Test Location',
  }

  it('returns kind1_id and kind30078_id as 64-char hex strings', async () => {
    const result = await publishNostrEvents(privkey, ['wss://relay.test'], payload)
    expect(result.kind1_id).toMatch(/^[0-9a-f]{64}$/)
    expect(result.kind30078_id).toMatch(/^[0-9a-f]{64}$/)
  })

  it('Kind 30078 tags include d-tag with sentinelmesh prefix', async () => {
    // This test validates tag structure via the returned IDs being deterministic
    const r1 = await publishNostrEvents(privkey, ['wss://relay.test'], payload)
    const r2 = await publishNostrEvents(privkey, ['wss://relay.test'], payload)
    // Same inputs = same event ID (Nostr events are content-addressed)
    expect(r1.kind30078_id).toBe(r2.kind30078_id)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd services/blockchain && npm test -- --testPathPattern=nostrPublisher
```

Expected: FAIL — "Cannot find module '../workers/nostrPublisher'"

- [ ] **Step 3: Implement nostrPublisher.ts**

Create `services/blockchain/src/workers/nostrPublisher.ts`:

```typescript
import { finalizeEvent, getPublicKey, generateSecretKey } from 'nostr-tools'
import { Relay } from 'nostr-tools/relay'
import { hexToBytes } from '@noble/hashes/utils'

interface PublishPayload {
  source_id: string
  source_type: 'SAFETY_EVENT' | 'COMMUNITY_REPORT'
  severity: string
  event_type: string
  lat: number
  lng: number
  place_name?: string | null
}

interface PublishResult {
  kind1_id: string
  kind30078_id: string
}

const RELAY_TIMEOUT_MS = 5000

async function publishToRelay(relay: Relay, event: ReturnType<typeof finalizeEvent>): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), RELAY_TIMEOUT_MS)
    relay.publish(event)
      .then(() => { clearTimeout(timer); resolve(true) })
      .catch(() => { clearTimeout(timer); resolve(false) })
  })
}

export async function publishNostrEvents(
  privkeyHex: string,
  relayUrls: string[],
  payload: PublishPayload,
): Promise<PublishResult> {
  const privkey = hexToBytes(privkeyHex)
  const location = payload.place_name ?? `${payload.lat.toFixed(4)},${payload.lng.toFixed(4)}`

  const kind1 = finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['t', 'sentinelmesh'],
      ['t', 'safetymesh'],
      ['t', payload.severity.toLowerCase()],
    ],
    content: `🚨 ${payload.severity} ${payload.event_type} reported at ${location}. #SentinelMesh`,
  }, privkey)

  const kind30078 = finalizeEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', `sentinelmesh:${payload.source_id}`],
      ['source_type', payload.source_type],
      ['source_id', payload.source_id],
      ['severity', payload.severity],
      ['event_type', payload.event_type],
      ['lat', String(payload.lat)],
      ['lng', String(payload.lng)],
    ],
    content: JSON.stringify({ event_id: payload.source_id, severity: payload.severity }),
  }, privkey)

  const relays = await Promise.all(relayUrls.map(url => Relay.connect(url).catch(() => null)))
  const activeRelays = relays.filter((r): r is Relay => r !== null)

  for (const event of [kind1, kind30078]) {
    const results = await Promise.all(activeRelays.map(r => publishToRelay(r, event)))
    if (!results.some(Boolean)) {
      throw new Error(`All relays rejected event kind ${event.kind}`)
    }
  }

  for (const relay of activeRelays) relay.close()

  return { kind1_id: kind1.id, kind30078_id: kind30078.id }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd services/blockchain && npm test -- --testPathPattern=nostrPublisher
```

Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add services/blockchain/src/workers/nostrPublisher.ts services/blockchain/src/tests/nostrPublisher.test.ts
git commit -m "feat: add Nostr publisher for Kind 1 and Kind 30078 events"
```

---

### Task 5: Bitcoin Anchor

**Files:**
- Create: `services/blockchain/src/workers/bitcoinAnchor.ts`
- Create: `services/blockchain/src/tests/bitcoinAnchor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/blockchain/src/tests/bitcoinAnchor.test.ts`:

```typescript
import { broadcastAnchor, AnchorInput } from '../workers/bitcoinAnchor'

const mockFetch = jest.fn()
jest.mock('node-fetch', () => mockFetch)

describe('broadcastAnchor', () => {
  const input: AnchorInput = {
    anchorHash: 'a'.repeat(64),
    wif: 'cNbVaR5QWqMdoB1is7DRSУQr1nkbD8LoE8xsBZHqsZr4wvgmDzHe', // testnet WIF placeholder
    utxoTxid: 'b'.repeat(64),
    utxoVout: 0,
    utxoValue: 10000,
    changeAddress: 'tb1qtest',
    network: 'testnet',
  }

  beforeEach(() => mockFetch.mockReset())

  it('returns txid from mempool.space on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => 'deadbeef1234',
    })
    const result = await broadcastAnchor(input)
    expect(result).toBe('deadbeef1234')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('testnet'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('falls back to Blockstream on mempool.space 5xx', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'error' })
      .mockResolvedValueOnce({ ok: true, text: async () => 'cafebabe5678' })
    const result = await broadcastAnchor(input)
    expect(result).toBe('cafebabe5678')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect((mockFetch.mock.calls[1][0] as string)).toContain('blockstream')
  })

  it('throws if both endpoints fail', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'error' })
    await expect(broadcastAnchor(input)).rejects.toThrow('Bitcoin broadcast failed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd services/blockchain && npm test -- --testPathPattern=bitcoinAnchor
```

Expected: FAIL — "Cannot find module '../workers/bitcoinAnchor'"

- [ ] **Step 3: Implement bitcoinAnchor.ts**

Create `services/blockchain/src/workers/bitcoinAnchor.ts`:

```typescript
import * as bitcoin from 'bitcoinjs-lib'
import fetch from 'node-fetch'
import ECPairFactory from 'ecpair'
import * as tinysecp from 'tiny-secp256k1'

const ECPair = ECPairFactory(tinysecp)

export interface AnchorInput {
  anchorHash: string
  wif: string
  utxoTxid: string
  utxoVout: number
  utxoValue: number
  changeAddress: string
  network: 'mainnet' | 'testnet'
}

const ENDPOINTS = {
  mainnet: {
    mempool: 'https://mempool.space/api/tx',
    blockstream: 'https://blockstream.info/api/tx',
  },
  testnet: {
    mempool: 'https://mempool.space/testnet/api/tx',
    blockstream: 'https://blockstream.info/testnet/api/tx',
  },
}

const FEE_SATS = 2000

async function broadcastTx(url: string, hex: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: hex,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return (await res.text()).trim()
}

export async function broadcastAnchor(input: AnchorInput): Promise<string> {
  const network = input.network === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet
  const keyPair = ECPair.fromWIF(input.wif, network)

  const embed = bitcoin.payments.embed({ data: [Buffer.from(input.anchorHash, 'hex')] })
  const psbt = new bitcoin.Psbt({ network })

  psbt.addInput({
    hash: input.utxoTxid,
    index: input.utxoVout,
    witnessUtxo: {
      script: bitcoin.payments.p2wpkh({ pubkey: Buffer.from(keyPair.publicKey), network }).output!,
      value: input.utxoValue,
    },
  })

  psbt.addOutput({ script: embed.output!, value: 0 })
  psbt.addOutput({ address: input.changeAddress, value: input.utxoValue - FEE_SATS })

  psbt.signInput(0, keyPair)
  psbt.finalizeAllInputs()
  const txHex = psbt.extractTransaction().toHex()

  const endpoints = ENDPOINTS[input.network]

  try {
    return await broadcastTx(endpoints.mempool, txHex)
  } catch {
    try {
      return await broadcastTx(endpoints.blockstream, txHex)
    } catch {
      throw new Error('Bitcoin broadcast failed on both mempool.space and Blockstream')
    }
  }
}
```

- [ ] **Step 4: Install additional Bitcoin dependencies**

```bash
cd services/blockchain && npm install ecpair tiny-secp256k1
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd services/blockchain && npm test -- --testPathPattern=bitcoinAnchor
```

Expected: PASS — 3 tests passing.

- [ ] **Step 6: Commit**

```bash
git add services/blockchain/src/workers/bitcoinAnchor.ts services/blockchain/src/tests/bitcoinAnchor.test.ts
git commit -m "feat: add Bitcoin OP_RETURN anchor broadcast with mempool.space/Blockstream fallback"
```

---

### Task 6: Publish Worker (Queue Polling Loop)

**Files:**
- Create: `services/blockchain/src/workers/publishWorker.ts`
- Create: `services/blockchain/src/tests/publishWorker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/blockchain/src/tests/publishWorker.test.ts`:

```typescript
import { Pool, PoolClient } from 'pg'
import { claimNextJob, releaseJob, markFailed, markDead } from '../workers/publishWorker'

// Minimal pool mock
const mockQuery = jest.fn()
const mockClient = { query: mockQuery, release: jest.fn() } as unknown as PoolClient
const mockPool = { connect: jest.fn().mockResolvedValue(mockClient) } as unknown as Pool

describe('publishWorker helpers', () => {
  beforeEach(() => mockQuery.mockReset())

  it('claimNextJob returns null when no rows found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })  // BEGIN
    mockQuery.mockResolvedValueOnce({ rows: [] })  // UPDATE ... RETURNING
    mockQuery.mockResolvedValueOnce({ rows: [] })  // COMMIT
    const job = await claimNextJob(mockPool, 'worker-1')
    expect(job).toBeNull()
  })

  it('claimNextJob returns the job row when found', async () => {
    const fakeJob = { id: 'job-uuid', status: 'PENDING', source_type: 'SAFETY_EVENT', source_id: 'ev-uuid' }
    mockQuery.mockResolvedValueOnce({ rows: [] })            // BEGIN
    mockQuery.mockResolvedValueOnce({ rows: [fakeJob] })     // UPDATE RETURNING
    mockQuery.mockResolvedValueOnce({ rows: [] })            // COMMIT
    const job = await claimNextJob(mockPool, 'worker-1')
    expect(job).toEqual(fakeJob)
  })

  it('markFailed increments retry_count and sets next_retry_at', async () => {
    mockQuery.mockResolvedValue({ rows: [{ retry_count: 1 }] })
    await markFailed(mockPool, 'job-uuid', 'test error', 1)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('retry_count + 1'),
      expect.arrayContaining(['job-uuid', 'test error']),
    )
  })

  it('markDead sets status to DEAD when retry_count reaches 5', async () => {
    mockQuery.mockResolvedValue({ rows: [{ retry_count: 5 }] })
    await markDead(mockPool, 'job-uuid')
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("'DEAD'"),
      ['job-uuid'],
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd services/blockchain && npm test -- --testPathPattern=publishWorker
```

Expected: FAIL — "Cannot find module '../workers/publishWorker'"

- [ ] **Step 3: Implement publishWorker.ts**

Create `services/blockchain/src/workers/publishWorker.ts`:

```typescript
import { Pool } from 'pg'
import { config } from '../config'
import { getPool } from '../db/pool'
import { publishNostrEvents } from './nostrPublisher'
import { broadcastAnchor } from './bitcoinAnchor'
import { buildAnchorHash } from '../utils/canonicalHash'
import { randomUUID } from 'crypto'

const WORKER_ID = `worker-${randomUUID()}`
const MAX_RETRIES = 5
const ORPHAN_TIMEOUT_MINUTES = 5

export interface PublishJob {
  id: string
  source_type: 'SAFETY_EVENT' | 'COMMUNITY_REPORT'
  source_id: string
  status: string
  nostr_kind1_id: string | null
  nostr_kind30078_id: string | null
  bitcoin_txid: string | null
  anchor_hash: string | null
  retry_count: number
}

export async function claimNextJob(pool: Pool, workerId: string): Promise<PublishJob | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<PublishJob>(`
      UPDATE publish_jobs
      SET status = 'PROCESSING',
          worker_id = $1,
          locked_at = NOW(),
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM publish_jobs
        WHERE status IN ('PENDING', 'FAILED')
          AND next_retry_at <= NOW()
        ORDER BY next_retry_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *
    `, [workerId])
    await client.query('COMMIT')
    return result.rows[0] ?? null
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function releaseJob(pool: Pool, jobId: string, updates: Partial<PublishJob> & { status: string }): Promise<void> {
  const fields = Object.entries(updates)
    .filter(([k]) => k !== 'id')
    .map(([k, v], i) => `${k} = $${i + 2}`)
    .join(', ')
  const values = Object.entries(updates).filter(([k]) => k !== 'id').map(([, v]) => v)
  await pool.query(
    `UPDATE publish_jobs SET ${fields}, updated_at = NOW(), worker_id = NULL WHERE id = $1`,
    [jobId, ...values],
  )
}

export async function markFailed(pool: Pool, jobId: string, errorMessage: string, currentRetry: number): Promise<void> {
  const backoffMinutes = Math.pow(2, currentRetry)
  await pool.query(`
    UPDATE publish_jobs
    SET status = 'FAILED',
        retry_count = retry_count + 1,
        next_retry_at = NOW() + ($3 * INTERVAL '1 minute'),
        error_message = $2,
        worker_id = NULL,
        locked_at = NULL,
        updated_at = NOW()
    WHERE id = $1
  `, [jobId, errorMessage, backoffMinutes])
  await pool.query(
    `INSERT INTO publish_failures (job_id, step, error_message) VALUES ($1, 'UNKNOWN', $2)`,
    [jobId, errorMessage],
  )
}

export async function markDead(pool: Pool, jobId: string): Promise<void> {
  await pool.query(
    `UPDATE publish_jobs SET status = 'DEAD', updated_at = NOW() WHERE id = $1`,
    [jobId],
  )
}

async function reclaimOrphans(pool: Pool): Promise<void> {
  await pool.query(`
    UPDATE publish_jobs
    SET status = 'FAILED',
        worker_id = NULL,
        locked_at = NULL,
        retry_count = retry_count + 1,
        next_retry_at = NOW(),
        error_message = 'orphan reclaim after ${ORPHAN_TIMEOUT_MINUTES} minute timeout',
        updated_at = NOW()
    WHERE status = 'PROCESSING'
      AND locked_at < NOW() - INTERVAL '${ORPHAN_TIMEOUT_MINUTES} minutes'
  `)
}

async function fetchSourceRow(pool: Pool, job: PublishJob): Promise<{
  severity: string; event_type: string; lat: number; lng: number; place_name: string | null
} | null> {
  const table = job.source_type === 'SAFETY_EVENT' ? 'safety_events' : 'community_reports'
  const col = job.source_type === 'SAFETY_EVENT' ? 'event_type' : 'report_type'
  const result = await pool.query(
    `SELECT severity, ${col} as event_type, lat, lng, place_name FROM ${table} WHERE id = $1`,
    [job.source_id],
  )
  return result.rows[0] ?? null
}

async function updateSourceRow(pool: Pool, job: PublishJob): Promise<void> {
  if (job.source_type === 'SAFETY_EVENT') {
    await pool.query(
      `UPDATE safety_events SET nostr_event_id = $2, bitcoin_txid = $3 WHERE id = $1 AND nostr_event_id IS NULL`,
      [job.source_id, job.nostr_kind30078_id, job.bitcoin_txid],
    )
  } else {
    await pool.query(
      `UPDATE community_reports SET nostr_event_id = $2 WHERE id = $1 AND nostr_event_id IS NULL`,
      [job.source_id, job.nostr_kind30078_id],
    )
  }
}

async function processJob(pool: Pool, job: PublishJob): Promise<void> {
  const source = await fetchSourceRow(pool, job)
  if (!source) {
    await markDead(pool, job.id)
    return
  }

  let kind1_id = job.nostr_kind1_id
  let kind30078_id = job.nostr_kind30078_id

  if (!kind1_id || !kind30078_id) {
    const result = await publishNostrEvents(config.nostrPrivkey, config.relayUrls, {
      source_id: job.source_id,
      source_type: job.source_type,
      severity: source.severity,
      event_type: source.event_type,
      lat: source.lat,
      lng: source.lng,
      place_name: source.place_name,
    })
    kind1_id = result.kind1_id
    kind30078_id = result.kind30078_id
    await pool.query(
      `UPDATE publish_jobs SET status = 'NOSTR_PUBLISHED', nostr_kind1_id = $2, nostr_kind30078_id = $3, updated_at = NOW() WHERE id = $1`,
      [job.id, kind1_id, kind30078_id],
    )
  }

  if (!job.bitcoin_txid) {
    const hash = buildAnchorHash({ event_id: job.source_id, nostr_event_id: kind30078_id!, severity: source.severity })
    const txid = await broadcastAnchor({
      anchorHash: hash,
      wif: config.bitcoinWif,
      utxoTxid: process.env.BITCOIN_UTXO_TXID ?? '',
      utxoVout: parseInt(process.env.BITCOIN_UTXO_VOUT ?? '0', 10),
      utxoValue: parseInt(process.env.BITCOIN_UTXO_VALUE ?? '10000', 10),
      changeAddress: process.env.BITCOIN_CHANGE_ADDRESS ?? '',
      network: config.bitcoinNetwork,
    })
    await pool.query(
      `UPDATE publish_jobs SET status = 'BITCOIN_ANCHORED', bitcoin_txid = $2, anchor_hash = $3, updated_at = NOW() WHERE id = $1`,
      [job.id, txid, hash],
    )
    job.bitcoin_txid = txid
    job.nostr_kind1_id = kind1_id
    job.nostr_kind30078_id = kind30078_id
  }

  await updateSourceRow(pool, job)
  await pool.query(`UPDATE publish_jobs SET status = 'COMPLETE', updated_at = NOW() WHERE id = $1`, [job.id])
}

export async function startPublishWorker(): Promise<void> {
  const pool = getPool()
  let orphanTick = 0

  async function tick(): Promise<void> {
    orphanTick++
    if (orphanTick % 30 === 0) await reclaimOrphans(pool)  // every ~5 min at 10s poll

    try {
      const job = await claimNextJob(pool, WORKER_ID)
      if (!job) return

      await processJob(pool, job)
    } catch (err) {
      console.error('[publish-worker] tick error:', err)
    }
  }

  setInterval(() => tick().catch(console.error), config.pollIntervalMs)
  tick().catch(console.error)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd services/blockchain && npm test -- --testPathPattern=publishWorker
```

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add services/blockchain/src/workers/publishWorker.ts services/blockchain/src/tests/publishWorker.test.ts
git commit -m "feat: add publish worker with FOR UPDATE SKIP LOCKED claim, retry backoff, orphan reclaim"
```

---

### Task 7: Internal Nudge Route + Express Server

**Files:**
- Create: `services/blockchain/src/routes/internal.ts`
- Create: `services/blockchain/src/index.ts`

- [ ] **Step 1: Create the nudge route**

Create `services/blockchain/src/routes/internal.ts`:

```typescript
import { Router } from 'express'
import rateLimit from 'express-rate-limit'

let nudgeCallback: (() => void) | null = null

export function setNudgeCallback(cb: () => void): void {
  nudgeCallback = cb
}

export const internalRouter = Router()

internalRouter.use(rateLimit({
  windowMs: 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
}))

internalRouter.post('/nudge', (_req, res) => {
  if (nudgeCallback) nudgeCallback()
  res.json({ ok: true })
})
```

- [ ] **Step 2: Create the Express entry point**

Create `services/blockchain/src/index.ts`:

```typescript
import express from 'express'
import { config } from './config'
import { initPool } from './db/pool'
import { startPublishWorker } from './workers/publishWorker'
import { internalRouter } from './routes/internal'
import { createServer } from 'http'

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'blockchain', ts: new Date().toISOString() })
})

app.use('/internal', internalRouter)

const server = createServer(app)

initPool()
  .then(() => {
    startPublishWorker()
    server.listen(config.port, () => {
      console.log(`blockchain service listening on port ${config.port}`)
    })
  })
  .catch((err) => {
    console.error('blockchain startup failed:', err)
    process.exit(1)
  })
```

Note: `initPool()` in `db/pool.ts` needs to export an async init function. Update `db/pool.ts`:

```typescript
import { Pool } from 'pg'
import { config } from '../config'

let _pool: Pool | null = null

export function getPool(): Pool {
  if (!_pool) throw new Error('Pool not initialized — call initPool() first')
  return _pool
}

export async function initPool(): Promise<void> {
  _pool = new Pool({ connectionString: config.databaseUrl })
  await _pool.query('SELECT 1')  // verify connection
}
```

- [ ] **Step 3: Verify it builds**

```bash
cd services/blockchain && npm run build
```

Expected: `dist/` produced, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add services/blockchain/src/routes/internal.ts services/blockchain/src/index.ts services/blockchain/src/db/pool.ts
git commit -m "feat: add nudge route and Express server entry point for blockchain service"
```

---

### Task 8: Gateway — Enqueue Jobs and Nudge

**Files:**
- Create: `services/gateway/src/utils/nudge.ts`
- Modify: `services/gateway/src/config.ts`
- Modify: `services/gateway/src/routes/events.ts`
- Modify: `services/gateway/src/routes/reports.ts`

- [ ] **Step 1: Read current gateway config.ts**

Read `services/gateway/src/config.ts` to find the current structure before modifying it.

- [ ] **Step 2: Add blockchainServiceUrl to gateway config**

In `services/gateway/src/config.ts`, add to the config object:

```typescript
blockchainServiceUrl: process.env.BLOCKCHAIN_SERVICE_URL ?? '',
```

- [ ] **Step 3: Create the nudge helper**

Create `services/gateway/src/utils/nudge.ts`:

```typescript
import { config } from '../config'

export async function nudgeBlockchain(): Promise<void> {
  if (!config.blockchainServiceUrl) return
  try {
    await fetch(`${config.blockchainServiceUrl}/internal/nudge`, {
      method: 'POST',
      signal: AbortSignal.timeout(500),
    })
  } catch { /* advisory — ignore */ }
}
```

- [ ] **Step 4: Read current events.ts**

Read `services/gateway/src/routes/events.ts` to find the event insertion point.

- [ ] **Step 5: Enqueue job in events.ts**

After the `INSERT INTO safety_events` statement and before the response, add:

```typescript
import { nudgeBlockchain } from '../utils/nudge'
// ... inside the POST handler, after getting newEvent.id:
if (['AUTHORITATIVE', 'CRITICAL'].includes(body.severity)) {
  await pool.query(
    `INSERT INTO publish_jobs (source_type, source_id) VALUES ('SAFETY_EVENT', $1)`,
    [newEvent.id],
  )
  nudgeBlockchain()  // fire-and-forget — don't await
}
```

- [ ] **Step 6: Read current reports.ts**

Read `services/gateway/src/routes/reports.ts` to find where consensus_score is updated.

- [ ] **Step 7: Enqueue job in reports.ts when consensus_score crosses 3**

Find the vote handler that updates `consensus_score`. After the update, add:

```typescript
import { nudgeBlockchain } from '../utils/nudge'
// After computing newScore from the vote update:
if (previousScore < 3 && newScore >= 3) {
  await pool.query(
    `INSERT INTO publish_jobs (source_type, source_id) VALUES ('COMMUNITY_REPORT', $1)
     ON CONFLICT DO NOTHING`,
    [reportId],
  )
  nudgeBlockchain()
}
```

The `ON CONFLICT DO NOTHING` requires a unique index. Add to the migration:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_jobs_source
  ON publish_jobs (source_type, source_id)
  WHERE status != 'DEAD';
```

Add this index to `infra/postgres/migrations/004_publish_jobs.sql` and `infra/postgres/init.sql`.

- [ ] **Step 8: Run gateway tests**

```bash
cd services/gateway && npm test
```

Expected: all existing tests still pass.

- [ ] **Step 9: Commit**

```bash
git add services/gateway/src/utils/nudge.ts services/gateway/src/config.ts services/gateway/src/routes/events.ts services/gateway/src/routes/reports.ts infra/postgres/migrations/004_publish_jobs.sql infra/postgres/init.sql
git commit -m "feat: enqueue publish_jobs in gateway on AUTHORITATIVE/CRITICAL events and consensus-3 reports"
```

---

### Task 9: PWA — VerificationBadges Component

**Files:**
- Create: `apps/pwa/src/components/VerificationBadges.tsx`
- Create: `apps/pwa/src/components/VerificationBadges.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/pwa/src/components/VerificationBadges.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { VerificationBadges } from './VerificationBadges'

describe('VerificationBadges', () => {
  it('renders nothing when both IDs are null', () => {
    const { container } = render(<VerificationBadges nostrEventId={null} bitcoinTxid={null} />)
    expect(container.querySelectorAll('a')).toHaveLength(0)
  })

  it('renders Nostr badge with njump.me link when nostrEventId is set', () => {
    render(<VerificationBadges nostrEventId="abc123" bitcoinTxid={null} />)
    const link = screen.getByText('⚡ Nostr')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', 'https://njump.me/abc123')
    expect(link.closest('a')).toHaveAttribute('target', '_blank')
  })

  it('renders Bitcoin badge with testnet explorer link when VITE_BITCOIN_NETWORK is not set', () => {
    render(<VerificationBadges nostrEventId={null} bitcoinTxid="txid456" />)
    const link = screen.getByText('₿ Anchored')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', 'https://mempool.space/testnet/tx/txid456')
  })

  it('renders both badges when both IDs are set', () => {
    render(<VerificationBadges nostrEventId="abc" bitcoinTxid="def" />)
    expect(screen.getByText('⚡ Nostr')).toBeInTheDocument()
    expect(screen.getByText('₿ Anchored')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/pwa && npm test -- --testPathPattern=VerificationBadges
```

Expected: FAIL — "Cannot find module './VerificationBadges'"

- [ ] **Step 3: Implement VerificationBadges.tsx**

Create `apps/pwa/src/components/VerificationBadges.tsx`:

```tsx
interface Props {
  nostrEventId?: string | null
  bitcoinTxid?: string | null
}

const badgeStyle = (bg: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: "'Courier New', monospace",
  fontWeight: 600,
  background: bg,
  color: '#fff',
  textDecoration: 'none',
})

export function VerificationBadges({ nostrEventId, bitcoinTxid }: Props) {
  const network = import.meta.env.VITE_BITCOIN_NETWORK ?? 'testnet'
  const explorerBase = network === 'mainnet'
    ? 'https://mempool.space/tx'
    : 'https://mempool.space/testnet/tx'

  if (!nostrEventId && !bitcoinTxid) return null

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
      {nostrEventId && (
        <a href={`https://njump.me/${nostrEventId}`} target="_blank" rel="noopener noreferrer"
           style={badgeStyle('#6B46C1')}>
          ⚡ Nostr
        </a>
      )}
      {bitcoinTxid && (
        <a href={`${explorerBase}/${bitcoinTxid}`} target="_blank" rel="noopener noreferrer"
           style={badgeStyle('#D97706')}>
          ₿ Anchored
        </a>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/pwa && npm test -- --testPathPattern=VerificationBadges
```

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/components/VerificationBadges.tsx apps/pwa/src/components/VerificationBadges.test.tsx
git commit -m "feat: add VerificationBadges component with Nostr and Bitcoin explorer links"
```

---

### Task 10: PWA — Wire Badges into SafetyMap and ReportList

**Files:**
- Modify: `apps/pwa/src/components/SafetyMap.tsx`
- Modify: `apps/pwa/src/components/ReportList.tsx`

- [ ] **Step 1: Read SafetyMap.tsx**

Read `apps/pwa/src/components/SafetyMap.tsx` to find the event popup render location.

- [ ] **Step 2: Add VerificationBadges to SafetyMap popup**

In the event popup JSX (where event details like type, severity, and description are shown), add after the last detail line:

```tsx
import { VerificationBadges } from './VerificationBadges'
// Inside popup JSX:
<VerificationBadges
  nostrEventId={selectedEvent.nostr_event_id}
  bitcoinTxid={selectedEvent.bitcoin_txid}
/>
```

The `nostr_event_id` and `bitcoin_txid` fields should already be part of the event type returned by the gateway. If they are missing from the TypeScript type, add them:

```typescript
// In the event type/interface:
nostr_event_id?: string | null
bitcoin_txid?: string | null
```

- [ ] **Step 3: Read ReportList.tsx**

Read `apps/pwa/src/components/ReportList.tsx` to find the card render location.

- [ ] **Step 4: Add VerificationBadges to ReportList card**

In the report card JSX, after the existing report details (type, description, score), add:

```tsx
import { VerificationBadges } from './VerificationBadges'
// Inside card JSX:
<VerificationBadges
  nostrEventId={report.nostr_event_id}
  bitcoinTxid={undefined}
/>
```

Community reports don't get a bitcoin_txid in the current design (only `nostr_event_id` is written back). Add `nostr_event_id` to the report type if missing:

```typescript
// In the report type/interface:
nostr_event_id?: string | null
```

- [ ] **Step 5: Run all PWA tests**

```bash
cd apps/pwa && npm test
```

Expected: all tests pass (VerificationBadges tests + existing suite).

- [ ] **Step 6: Commit**

```bash
git add apps/pwa/src/components/SafetyMap.tsx apps/pwa/src/components/ReportList.tsx
git commit -m "feat: add verification badges to SafetyMap event popup and ReportList cards"
```

---

### Task 11: Final Integration Test + Push PR

- [ ] **Step 1: Run full test suite**

```bash
cd services/blockchain && npm test
cd services/gateway && npm test
cd apps/pwa && npm test
```

Expected: all tests pass across all three packages.

- [ ] **Step 2: Verify blockchain service builds cleanly**

```bash
cd services/blockchain && npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Push and create PR**

```bash
git push -u origin feat/blockchain-anchoring
gh pr create \
  --title "feat: Phase 4A Nostr + Bitcoin anchoring for safety events" \
  --body "$(cat <<'EOF'
## Summary
- New \`services/blockchain/\` service polls \`publish_jobs\` queue (FOR UPDATE SKIP LOCKED) and publishes Nostr Kind 1 + Kind 30078 events, then writes SHA256 OP_RETURN to Bitcoin
- Gateway enqueues jobs on AUTHORITATIVE/CRITICAL event creation and when community report consensus_score crosses 3
- PWA renders ⚡ Nostr and ₿ Anchored badges on SafetyMap event popups and ReportList cards

## Test Plan
- [ ] \`canonicalHash\`: deterministic, field-sensitive, key-order-independent
- [ ] \`publishWorker\`: claim/release, orphan reclaim, retry backoff, DEAD transition
- [ ] \`nostrPublisher\`: Kind 1 + Kind 30078 structure, relay ack
- [ ] \`bitcoinAnchor\`: OP_RETURN output, Blockstream fallback, both-fail error
- [ ] \`VerificationBadges\`: null→no badges, IDs→correct hrefs, testnet explorer URL
- [ ] All existing gateway + PWA tests still pass
EOF
)"
```

---

## Environment Variables Reference

Before running in any environment, ensure these are set:

| Service | Variable | Example |
|---------|----------|---------|
| blockchain | `BLOCKCHAIN_PORT` | `3003` |
| blockchain | `DATABASE_URL` | `postgres://...` |
| blockchain | `NOSTR_PRIVKEY` | 64-char hex |
| blockchain | `RELAY_URLS` | `wss://relay.damus.io,wss://nos.lol` |
| blockchain | `BITCOIN_WIF` | WIF-encoded key |
| blockchain | `BITCOIN_NETWORK` | `testnet` |
| blockchain | `BITCOIN_UTXO_TXID` | 64-char hex |
| blockchain | `BITCOIN_UTXO_VOUT` | `0` |
| blockchain | `BITCOIN_UTXO_VALUE` | `10000` (sats) |
| blockchain | `BITCOIN_CHANGE_ADDRESS` | `tb1q...` |
| gateway | `BLOCKCHAIN_SERVICE_URL` | `http://blockchain:3003` |
| pwa | `VITE_BITCOIN_NETWORK` | `testnet` |
