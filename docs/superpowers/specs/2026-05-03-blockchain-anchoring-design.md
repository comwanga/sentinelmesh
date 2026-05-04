# SentinelMesh Phase 4A: Nostr + Bitcoin Anchoring — Design Spec

**Goal:** Give every safety event and community report a cryptographic footprint on Nostr (public, human-readable) and on the Bitcoin blockchain (tamper-proof audit trail), with verification badges surfaced in the PWA.

**Architecture:** A standalone `services/blockchain/` TypeScript worker polls a `publish_jobs` queue using `FOR UPDATE SKIP LOCKED` to safely handle multiple instances. It publishes dual Nostr events (Kind 1 + Kind 30078) then writes an OP_RETURN transaction to Bitcoin mainnet/testnet via mempool.space or Blockstream. The gateway enqueues jobs at creation time and fires an advisory nudge to the worker. The PWA renders ⚡ Nostr and ₿ Bitcoin badges on event popups and report cards once the IDs are present.

**Tech Stack:** TypeScript + Express (blockchain service), `nostr-tools` (NIP-01 signing), `bitcoinjs-lib` + mempool.space broadcast API, PostgreSQL (`FOR UPDATE SKIP LOCKED`), existing React/Redux PWA.

---

## 1. Data Model

Two new tables added to `infra/postgres/init.sql`. The existing `blockchain_anchors` table (batch-style) is left unchanged; these are per-event tables.

### `publish_jobs`

```sql
CREATE TABLE publish_jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_type     VARCHAR(20) NOT NULL,   -- 'SAFETY_EVENT' | 'COMMUNITY_REPORT'
  source_id       UUID NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  -- PENDING → PROCESSING → NOSTR_PUBLISHED → BITCOIN_ANCHORED → COMPLETE
  --                                                             → FAILED → DEAD
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

CREATE INDEX idx_publish_jobs_claimable
  ON publish_jobs (next_retry_at, status)
  WHERE status IN ('PENDING', 'FAILED');
```

**Status semantics:**
- `PENDING` — inserted by gateway, not yet claimed
- `PROCESSING` — claimed by a worker (has `worker_id` + `locked_at`)
- `NOSTR_PUBLISHED` — both Kind 1 and Kind 30078 written; `nostr_kind1_id` + `nostr_kind30078_id` set
- `BITCOIN_ANCHORED` — OP_RETURN TX broadcast; `bitcoin_txid` + `anchor_hash` set
- `COMPLETE` — confirmed; source row updated with IDs
- `FAILED` — error; will retry if `retry_count < 5`
- `DEAD` — `retry_count >= 5`; needs manual intervention

**Claiming pattern (atomic, multi-instance safe):**

```sql
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
RETURNING *;
```

**Retry backoff on FAILED → FAILED re-enqueue:**

```sql
UPDATE publish_jobs
SET status = 'FAILED',
    retry_count = retry_count + 1,
    next_retry_at = NOW() + INTERVAL '1 minute' * POWER(2, retry_count),
    error_message = $2,
    worker_id = NULL,
    locked_at = NULL,
    updated_at = NOW()
WHERE id = $1
RETURNING retry_count;
-- If retry_count >= 5: set status = 'DEAD' instead
```

No heartbeat column needed — each publish step is fast and atomic (Nostr: ~100ms, Bitcoin broadcast: ~500ms). Orphaned PROCESSING rows from crashed workers are reclaimed by a separate 5-minute cleanup query.

### `publish_failures`

Permanent audit trail. Never deleted.

```sql
CREATE TABLE publish_failures (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id        UUID NOT NULL REFERENCES publish_jobs(id),
  step          VARCHAR(30) NOT NULL,  -- 'NOSTR_KIND1' | 'NOSTR_KIND30078' | 'BITCOIN_BROADCAST'
  error_message TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_publish_failures_job ON publish_failures(job_id);
```

If `publish_failures` grows unexpectedly (>1000 rows/day in steady state), the monitoring concern is surfaced in logs. No automatic pruning — a future ops task can archive old rows if needed.

---

## 2. Blockchain Service (`services/blockchain/`)

### File Structure

```
services/blockchain/
  package.json
  tsconfig.json
  src/
    index.ts              — Express server, starts worker loop
    config.ts             — env vars (NOSTR_PRIVKEY, BITCOIN_NETWORK, RELAY_URLS, etc.)
    db/
      pool.ts             — pg Pool (shared connection pool)
    workers/
      publishWorker.ts    — polling loop, claim/release lifecycle
      nostrPublisher.ts   — Kind 1 + Kind 30078 sign + relay publish
      bitcoinAnchor.ts    — OP_RETURN build + mempool.space/Blockstream broadcast
    routes/
      internal.ts         — POST /internal/nudge (advisory, rate-limited)
    utils/
      canonicalHash.ts    — SHA256(canonical JSON {event_id, nostr_event_id, severity})
```

### Worker Loop

`publishWorker.ts` runs on a 10-second poll interval. Each tick:
1. Claim one job with `FOR UPDATE SKIP LOCKED`
2. If no job: sleep until next tick
3. Dispatch to `processJob(job)`:
   - If `PENDING` or `FAILED` with no `nostr_kind1_id`: run Nostr publish step → set `NOSTR_PUBLISHED`
   - If `NOSTR_PUBLISHED`: run Bitcoin anchor step → set `BITCOIN_ANCHORED`
   - If `BITCOIN_ANCHORED`: update source row → set `COMPLETE`
4. On any error: write to `publish_failures`, back-off retry or mark `DEAD`

Orphan reclaim query (runs every 5 minutes):

```sql
UPDATE publish_jobs
SET status = 'FAILED',
    worker_id = NULL,
    locked_at = NULL,
    retry_count = retry_count + 1,
    next_retry_at = NOW(),
    error_message = 'orphan reclaim after 5 minute timeout'
WHERE status = 'PROCESSING'
  AND locked_at < NOW() - INTERVAL '5 minutes';
```

### Nostr Publisher (`nostrPublisher.ts`)

Uses `nostr-tools`. Publishes two events to all configured relays:

**Kind 1 (human-readable):**
```
content: "🚨 [SEVERITY] [event_type] reported at [place_name || lat,lng]. #SentinelMesh"
tags: [["t", "sentinelmesh"], ["t", "safetymesh"], ["t", severity.toLowerCase()]]
```

**Kind 30078 (parameterized replaceable, machine-readable):**
```json
{
  "kind": 30078,
  "tags": [
    ["d", "sentinelmesh:<source_id>"],
    ["source_type", "SAFETY_EVENT"],
    ["source_id", "<uuid>"],
    ["severity", "CRITICAL"],
    ["event_type", "SHOOTING"],
    ["lat", "37.7749"],
    ["lng", "-122.4194"]
  ],
  "content": "{\"event_id\":\"...\",\"severity\":\"CRITICAL\",...}"
}
```

Both events are signed with the service's Nostr private key (env: `NOSTR_PRIVKEY`). The service key is separate from user keys — it represents SentinelMesh as the publisher, not individual users. Key rotation means updating the env var and redeploying; old event IDs remain valid forever on Nostr.

Relay publish: connect to each relay in `RELAY_URLS`, send event, wait for `["OK", ...]` with a 5-second timeout. If at least one relay accepts, the step succeeds. Partial relay failures are logged but do not fail the job.

### Bitcoin Anchor (`bitcoinAnchor.ts`)

**Hash construction** (`canonicalHash.ts`):

```typescript
import { createHash } from 'crypto'

export function buildAnchorHash(params: {
  event_id: string
  nostr_event_id: string  // Kind 30078 id (machine-readable)
  severity: string
}): string {
  const canonical = JSON.stringify({
    event_id: params.event_id,
    nostr_event_id: params.nostr_event_id,
    severity: params.severity,
  }, Object.keys(params).sort())  // sorted keys = deterministic
  return createHash('sha256').update(canonical).digest('hex')
}
```

No timestamp in the hash — timestamps change on retry. The same event always produces the same hash.

**TX construction** (using `bitcoinjs-lib`):

```typescript
const embed = bitcoin.payments.embed({ data: [Buffer.from(hash, 'hex')] })
const tx = new bitcoin.Transaction()
tx.addInput(utxoTxid, utxoVout)
tx.addOutput(embed.output!, 0)                // OP_RETURN output, 0 sats
tx.addOutput(changeAddress, changeAmount)     // UTXO remainder minus fee
tx.sign(...)
```

**Broadcast**: POST to `https://mempool.space/api/tx` (mainnet) or `https://mempool.space/testnet/api/tx` (testnet). Falls back to `https://blockstream.info/api/tx` on 5xx. Returns txid.

**Bitcoin key risk**: Private key (`BITCOIN_WIF`) controls the UTXO used for fee payment. It is passed via environment variable only — never stored in DB or logged. The UTXO must be pre-funded; the service does not manage wallet recovery. Operators are responsible for monitoring UTXO balance and refilling as needed.

**Trigger threshold**: Jobs are created for:
- ALL events with `severity = 'AUTHORITATIVE'`
- Events with `severity = 'CRITICAL'` immediately at creation
- Community reports that reach `consensus_score >= 3`

### Internal Nudge Route (`routes/internal.ts`)

```
POST /internal/nudge
```

Advisory only. Tells the worker to poll immediately instead of waiting for the next 10-second tick. Rate-limited to 10 nudges/second (sliding window). If the nudge fails or times out (500ms), the gateway swallows the error — the worker's polling loop will pick up the job within 10 seconds regardless.

The nudge endpoint is not authenticated (it is internal-network only, not exposed externally).

---

## 3. Gateway Changes

### Job Enqueue (`services/gateway/src/`)

Two insertion points:

**`routes/events.ts`** — after `INSERT INTO safety_events`:
```typescript
if (['AUTHORITATIVE', 'CRITICAL'].includes(body.severity)) {
  await pool.query(
    `INSERT INTO publish_jobs (source_type, source_id) VALUES ('SAFETY_EVENT', $1)`,
    [newEvent.id]
  )
  nudgeBlockchain()  // fire-and-forget
}
```

**`routes/reports.ts`** — after consensus score update crosses threshold:
```typescript
if (updatedScore >= 3) {
  await pool.query(
    `INSERT INTO publish_jobs (source_type, source_id) VALUES ('COMMUNITY_REPORT', $1)
     ON CONFLICT DO NOTHING`,  // idempotent — score crosses 3 only once
    [reportId]
  )
  nudgeBlockchain()
}
```

**`nudgeBlockchain()` helper** (shared util):
```typescript
async function nudgeBlockchain(): Promise<void> {
  try {
    await fetch(`${config.blockchainServiceUrl}/internal/nudge`, {
      method: 'POST',
      signal: AbortSignal.timeout(500),
    })
  } catch { /* advisory — ignore */ }
}
```

The nudge is fire-and-forget. If `blockchainServiceUrl` is not configured, the function is a no-op.

### Source Row Update

When a job reaches `COMPLETE`, the blockchain service updates:
- `safety_events`: sets `nostr_event_id`, `bitcoin_txid` where not already set
- `community_reports`: sets `nostr_event_id` where not already set

The `bitcoin_txid` is stored as an opaque string. The explorer URL is constructed client-side using `VITE_BITCOIN_NETWORK` env var — not derived from anything stored in the DB.

---

## 4. PWA Changes

### Redux State

`eventsSlice` and `reportSlice` already have `nostr_event_id` and `bitcoin_txid` on their types. No slice changes needed — these fields are already returned by the gateway's GET endpoints once the blockchain service writes them back.

### Verification Badges

**`components/VerificationBadges.tsx`** — reusable component:

```tsx
interface Props {
  nostrEventId?: string | null
  bitcoinTxid?: string | null
}

export function VerificationBadges({ nostrEventId, bitcoinTxid }: Props) {
  const network = import.meta.env.VITE_BITCOIN_NETWORK ?? 'testnet'
  const explorerBase = network === 'mainnet'
    ? 'https://mempool.space/tx'
    : 'https://mempool.space/testnet/tx'

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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

Badges only render when the IDs are non-null. A report/event that hasn't been published yet shows no badge — not a placeholder.

**Integration points:**
- `SafetyMap` event popup: render `<VerificationBadges>` below the existing event details
- `ReportList` card: render `<VerificationBadges>` at the bottom of each card

---

## 5. Testing Strategy

- **`canonicalHash.ts`**: unit test — same inputs always produce same hash; different inputs produce different hashes
- **`publishWorker.ts`**: integration test against real PostgreSQL — claim/release lifecycle, orphan reclaim, retry backoff, DEAD transition
- **`nostrPublisher.ts`**: unit test with mocked relay websocket — verify Kind 1 and Kind 30078 structure, tag presence, relay ack handling
- **`bitcoinAnchor.ts`**: unit test with mocked HTTP — verify OP_RETURN output structure, fallback to Blockstream on 5xx
- **`VerificationBadges`**: render test — badges absent when IDs null, present with correct hrefs when IDs set, correct explorer URL per VITE_BITCOIN_NETWORK

---

## 6. Environment Variables

**`services/blockchain/`**:
- `BLOCKCHAIN_PORT` (default 3003)
- `DATABASE_URL`
- `NOSTR_PRIVKEY` — hex private key for the SentinelMesh publisher identity
- `RELAY_URLS` — comma-separated list, e.g. `wss://relay.damus.io,wss://nos.lol`
- `BITCOIN_WIF` — WIF-encoded private key controlling the fee UTXO
- `BITCOIN_NETWORK` — `mainnet` | `testnet` (default `testnet`)
- `POLL_INTERVAL_MS` (default 10000)

**`apps/pwa/`**:
- `VITE_BITCOIN_NETWORK` — `mainnet` | `testnet` (default `testnet`; drives explorer URL)

**`services/gateway/`**:
- `BLOCKCHAIN_SERVICE_URL` — e.g. `http://blockchain:3003` (optional; nudge is no-op if absent)

---

## 7. What This Explicitly Does NOT Do

- No wallet management or UTXO recovery — the operator pre-funds the address
- No Nostr relay discovery — relay list is static config
- No Bitcoin confirmation polling — txid stored immediately on broadcast; `bitcoin_block` (existing column on `safety_events`) is a future enhancement
- No anchoring for low-severity events (`LOW`, `MEDIUM`, `HIGH` safety events; community reports below consensus 3)
- No anchoring for family circle location blobs — those are private E2EE data
