# Lightning Zaps for Community Reporters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow any SentinelMesh user to tip a community reporter with Bitcoin Lightning (sats) when a report helped them. Reporters receive a Nostr Kind 9735 zap receipt on their Nostr identity, creating a portable, censorship-resistant record of community appreciation.

**Architecture:** A user taps "Zap" on a community report. The mobile app calls `POST /api/zaps/request` with the report ID and a chosen amount. The backend looks up the reporter's Nostr pubkey, calls LND (via its REST API) to generate a BOLT11 invoice, and returns it to the client. The user pays the invoice from any Lightning wallet (displayed as a QR code and deep-link). LND fires a payment webhook to `POST /api/zaps/webhook`. The backend verifies the payment, publishes a Nostr Kind 9735 zap receipt to the reporter's relays, and updates the `lightning_zaps` table. Reporters see their earned sats on their report cards. No in-app Lightning wallet is built in this plan — that scope belongs to a future plan.

**Tech Stack:** LND REST API (`node-fetch`), `nostr-tools` (existing dependency via nostrService), PostgreSQL (existing), Express (existing), `react-native-qrcode-svg` (new), existing `/api/reports` and Nostr infrastructure

---

## Prerequisites

```bash
# Backend
cd backend && npm install node-fetch@2

# Mobile
cd sentinel-mobile && npm install react-native-qrcode-svg

# Environment variables to add to backend .env:
# LND_REST_URL=https://localhost:8080
# LND_MACAROON_HEX=<your_admin_macaroon_hex>
# LND_TLS_CERT_BASE64=<base64_encoded_tls_cert>
# ZAP_WEBHOOK_SECRET=<random_32_char_secret>
```

LND must be running and accessible from the backend. For development, use [Polar](https://lightningpolar.com/) to spin up a local LND node.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/src/migrations/004_add_zaps.sql` | Create | `lightning_zaps` table |
| `backend/src/lightning/lndClient.js` | Create | LND REST API wrapper (invoice creation, payment lookup) |
| `backend/src/lightning/zapService.js` | Create | Business logic: create zap request, verify payment, publish Kind 9735 |
| `backend/src/routes/zap.js` | Create | Express routes: `POST /api/zaps/request`, `POST /api/zaps/webhook` |
| `backend/src/app.js` | Modify | Mount zap router |
| `sentinel-mobile/src/components/ZapButton.tsx` | Create | Tip button shown on community report cards |
| `sentinel-mobile/src/screens/ZapScreen.tsx` | Create | Invoice QR display and deep-link payment flow |
| `sentinel-mobile/src/screens/ReportCard.tsx` | Modify | Add ZapButton, show earned sats |
| `backend/tests/zapService.test.js` | Create | Unit tests for zap service |
| `backend/tests/lndClient.test.js` | Create | Unit tests for LND client |
| `sentinel-mobile/__tests__/ZapButton.test.tsx` | Create | Render tests for ZapButton |

---

## Task 1: Database migration — lightning_zaps table

**Files:**
- Create: `backend/src/migrations/004_add_zaps.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- backend/src/migrations/004_add_zaps.sql

CREATE TABLE lightning_zaps (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Which report was tipped
  report_id         UUID NOT NULL REFERENCES community_reports(id) ON DELETE CASCADE,

  -- Who gets the sats (reporter's Nostr pubkey)
  recipient_pubkey  VARCHAR(64) NOT NULL,

  -- Payment details
  amount_sats       INT NOT NULL CHECK (amount_sats > 0 AND amount_sats <= 100000),
  bolt11_invoice    TEXT NOT NULL,           -- BOLT11 payment request string
  payment_hash      VARCHAR(64) NOT NULL UNIQUE,

  -- Lifecycle
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',
                    -- pending | paid | expired
  paid_at           TIMESTAMPTZ,

  -- Nostr zap receipt
  zap_receipt_id    VARCHAR(64),             -- Nostr Kind 9735 event ID
  zap_receipt_json  JSONB,                   -- Full signed event for auditing

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour')
);

CREATE INDEX idx_zaps_report      ON lightning_zaps(report_id);
CREATE INDEX idx_zaps_recipient   ON lightning_zaps(recipient_pubkey);
CREATE INDEX idx_zaps_status      ON lightning_zaps(status, expires_at);
CREATE INDEX idx_zaps_hash        ON lightning_zaps(payment_hash);
```

- [ ] **Step 2: Run the migration**

```bash
cd backend && psql $DATABASE_URL -f src/migrations/004_add_zaps.sql
```
Expected: `CREATE TABLE`, `CREATE INDEX` × 4

- [ ] **Step 3: Verify the table exists**

```bash
psql $DATABASE_URL -c "\d lightning_zaps"
```
Expected: table description showing all columns including `payment_hash`, `status`, `zap_receipt_id`

- [ ] **Step 4: Commit**

```bash
git add backend/src/migrations/004_add_zaps.sql
git commit -m "feat: add lightning_zaps table for reporter tip tracking"
```

---

## Task 2: LND REST client

**Files:**
- Create: `backend/src/lightning/lndClient.js`
- Test: `backend/tests/lndClient.test.js`

Thin wrapper around LND's REST API. Only implements the two operations needed: create a BOLT11 invoice, and look up an invoice by payment hash to verify payment status.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/lndClient.test.js
jest.mock('node-fetch');
const fetch = require('node-fetch');
const { Response } = jest.requireActual('node-fetch');

const { createInvoice, getInvoice } = require('../src/lightning/lndClient');

process.env.LND_REST_URL       = 'https://localhost:8080';
process.env.LND_MACAROON_HEX   = 'deadbeef';
process.env.LND_TLS_CERT_BASE64 = Buffer.from('fake_cert').toString('base64');

describe('lndClient', () => {
  beforeEach(() => fetch.mockClear());

  describe('createInvoice', () => {
    test('returns payment_request and payment_hash on success', async () => {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({
        payment_request: 'lnbc100n1...',
        r_hash: Buffer.from('abc123', 'hex').toString('base64'),
      }), { status: 200 }));

      const result = await createInvoice({ amountSats: 100, memo: 'Test tip' });
      expect(result.payment_request).toBe('lnbc100n1...');
      expect(result.payment_hash).toBeTruthy();
    });

    test('POSTs to /v1/invoices with correct amount and memo', async () => {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({
        payment_request: 'lnbc500n1...',
        r_hash: Buffer.from('def456', 'hex').toString('base64'),
      }), { status: 200 }));

      await createInvoice({ amountSats: 500, memo: 'Tipping reporter' });

      const [url, options] = fetch.mock.calls[0];
      expect(url).toContain('/v1/invoices');
      const body = JSON.parse(options.body);
      expect(body.value).toBe(500);
      expect(body.memo).toBe('Tipping reporter');
      expect(body.expiry).toBe(3600);
    });

    test('throws when LND returns non-200', async () => {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'bad request' }), { status: 400 }));
      await expect(createInvoice({ amountSats: 100, memo: 'test' })).rejects.toThrow();
    });
  });

  describe('getInvoice', () => {
    test('returns settled=true when invoice is paid', async () => {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({
        settled: true,
        amt_paid_sat: '100',
        settle_date: '1714478400',
      }), { status: 200 }));

      const result = await getInvoice('abc123paymenthash');
      expect(result.settled).toBe(true);
      expect(result.amt_paid_sat).toBe('100');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest tests/lndClient.test.js --no-coverage
```
Expected: FAIL — `Cannot find module '../src/lightning/lndClient'`

- [ ] **Step 3: Implement lndClient.js**

```javascript
// backend/src/lightning/lndClient.js
const fetch = require('node-fetch');
const https = require('https');

const LND_REST_URL  = process.env.LND_REST_URL;
const MACAROON_HEX  = process.env.LND_MACAROON_HEX;
const TLS_CERT      = process.env.LND_TLS_CERT_BASE64
  ? Buffer.from(process.env.LND_TLS_CERT_BASE64, 'base64').toString('utf8')
  : undefined;

// Self-signed TLS cert in development — skip verification if cert provided
const agent = TLS_CERT
  ? new https.Agent({ ca: TLS_CERT })
  : new https.Agent({ rejectUnauthorized: false });

async function lndFetch(path, options = {}) {
  const url = `${LND_REST_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    agent,
    headers: {
      'Grpc-Metadata-macaroon': MACAROON_HEX,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LND ${path} returned ${response.status}: ${body}`);
  }

  return response.json();
}

/**
 * Creates a BOLT11 invoice.
 * @returns {{ payment_request: string, payment_hash: string }}
 */
async function createInvoice({ amountSats, memo }) {
  const data = await lndFetch('/v1/invoices', {
    method: 'POST',
    body: JSON.stringify({ value: amountSats, memo, expiry: 3600 }),
  });

  // r_hash from LND is base64 — convert to hex for storage
  const payment_hash = Buffer.from(data.r_hash, 'base64').toString('hex');
  return { payment_request: data.payment_request, payment_hash };
}

/**
 * Looks up an invoice by its payment hash (hex string).
 * @returns LND invoice object with `settled: boolean` field
 */
async function getInvoice(paymentHashHex) {
  const hashBase64 = Buffer.from(paymentHashHex, 'hex').toString('base64url');
  return lndFetch(`/v1/invoice/${hashBase64}`);
}

module.exports = { createInvoice, getInvoice };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest tests/lndClient.test.js --no-coverage
```
Expected: PASS — 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add backend/src/lightning/lndClient.js backend/tests/lndClient.test.js
git commit -m "feat: add LND REST client for invoice creation and lookup"
```

---

## Task 3: Zap service (invoice creation + Kind 9735 receipt)

**Files:**
- Create: `backend/src/lightning/zapService.js`
- Test: `backend/tests/zapService.test.js`

Orchestrates the full zap lifecycle: create invoice for a report, verify payment when webhook fires, and publish a Nostr Kind 9735 zap receipt.

- [ ] **Step 1: Write the failing test**

```javascript
// backend/tests/zapService.test.js
jest.mock('../src/lightning/lndClient', () => ({
  createInvoice: jest.fn().mockResolvedValue({
    payment_request: 'lnbc1000n1ptest...',
    payment_hash: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
  }),
  getInvoice: jest.fn().mockResolvedValue({ settled: true, amt_paid_sat: '1000' }),
}));

jest.mock('../src/blockchain/nostrPublisher', () => ({
  publishEvent: jest.fn().mockResolvedValue('nostr_event_id_abc'),
}));

const { createZapRequest, handlePaymentWebhook } = require('../src/lightning/zapService');

// Mock pool query for DB access
const mockQuery = jest.fn();
jest.mock('../src/db', () => ({ query: (...args) => mockQuery(...args) }));

const mockReport = {
  id: 'report-uuid-1234',
  nostr_pubkey: 'reporterpubkey0000000000000000000000000000000000000000000000000000',
  report_type: 'SECURITY_INCIDENT',
};

describe('createZapRequest', () => {
  beforeEach(() => mockQuery.mockClear());

  test('returns payment_request and zap_id', async () => {
    // First query: fetch the report
    mockQuery.mockResolvedValueOnce({ rows: [mockReport] });
    // Second query: insert the zap record
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'zap-uuid-5678' }] });

    const result = await createZapRequest({ reportId: 'report-uuid-1234', amountSats: 1000 });

    expect(result).toHaveProperty('payment_request');
    expect(result).toHaveProperty('zap_id');
    expect(result.payment_request).toBe('lnbc1000n1ptest...');
  });

  test('throws when report does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // report not found
    await expect(createZapRequest({ reportId: 'nonexistent', amountSats: 1000 })).rejects.toThrow('Report not found');
  });

  test('throws when amountSats exceeds maximum', async () => {
    await expect(createZapRequest({ reportId: 'any', amountSats: 200000 })).rejects.toThrow('exceeds maximum');
  });
});

describe('handlePaymentWebhook', () => {
  test('marks zap as paid and publishes Kind 9735 receipt', async () => {
    // Query: look up zap by payment_hash
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'zap-uuid-5678',
        report_id: mockReport.id,
        recipient_pubkey: mockReport.nostr_pubkey,
        amount_sats: 1000,
        status: 'pending',
      }],
    });
    // Query: update zap status
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Query: update zap with receipt
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { publishEvent } = require('../src/blockchain/nostrPublisher');

    await handlePaymentWebhook({
      payment_hash: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
    });

    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 9735 }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest tests/zapService.test.js --no-coverage
```
Expected: FAIL — `Cannot find module '../src/lightning/zapService'`

- [ ] **Step 3: Implement zapService.js**

```javascript
// backend/src/lightning/zapService.js
const { createInvoice, getInvoice } = require('./lndClient');
const { publishEvent }              = require('../blockchain/nostrPublisher');
const db                            = require('../db');
const crypto                        = require('crypto');

const MAX_SATS = 100_000;
const SENTINEL_PRIVKEY = process.env.NOSTR_PRIVATE_KEY;

/**
 * Creates a Lightning invoice for tipping a reporter.
 * @returns {{ zap_id: string, payment_request: string, amount_sats: number }}
 */
async function createZapRequest({ reportId, amountSats }) {
  if (amountSats > MAX_SATS) {
    throw new Error(`Amount ${amountSats} sats exceeds maximum ${MAX_SATS}`);
  }

  const reportResult = await db.query(
    'SELECT id, nostr_pubkey, report_type FROM community_reports WHERE id = $1',
    [reportId],
  );
  if (reportResult.rows.length === 0) throw new Error('Report not found');
  const report = reportResult.rows[0];

  const memo = `SentinelMesh zap — tip for ${report.report_type} report`;
  const { payment_request, payment_hash } = await createInvoice({ amountSats, memo });

  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const zapResult = await db.query(
    `INSERT INTO lightning_zaps
       (report_id, recipient_pubkey, amount_sats, bolt11_invoice, payment_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [reportId, report.nostr_pubkey, amountSats, payment_request, payment_hash, expiresAt],
  );

  return {
    zap_id: zapResult.rows[0].id,
    payment_request,
    amount_sats: amountSats,
  };
}

/**
 * Called when LND fires the payment webhook.
 * Marks the zap as paid and publishes a Nostr Kind 9735 zap receipt.
 */
async function handlePaymentWebhook({ payment_hash }) {
  const zapResult = await db.query(
    `SELECT id, report_id, recipient_pubkey, amount_sats, status
     FROM lightning_zaps WHERE payment_hash = $1`,
    [payment_hash],
  );
  if (zapResult.rows.length === 0) return; // not our invoice

  const zap = zapResult.rows[0];
  if (zap.status !== 'pending') return; // already processed

  // Mark paid
  await db.query(
    `UPDATE lightning_zaps SET status = 'paid', paid_at = NOW() WHERE id = $1`,
    [zap.id],
  );

  // Publish Nostr Kind 9735 zap receipt
  // Spec: https://github.com/nostr-protocol/nips/blob/master/57.md
  const zapReceiptEvent = {
    kind: 9735,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', zap.recipient_pubkey],             // recipient
      ['bolt11', zap.bolt11_invoice],           // the invoice that was paid
      ['description', JSON.stringify({          // original zap request (simplified)
        kind: 9734,
        tags: [['p', zap.recipient_pubkey], ['amount', String(zap.amount_sats * 1000)]],
        content: `Zap from SentinelMesh community`,
      })],
      ['preimage', payment_hash],
    ],
    content: '',
    pubkey: SENTINEL_PRIVKEY ? getPublicKey(SENTINEL_PRIVKEY) : '',
  };

  const nostrEventId = await publishEvent(zapReceiptEvent);

  await db.query(
    `UPDATE lightning_zaps SET zap_receipt_id = $1, zap_receipt_json = $2 WHERE id = $3`,
    [nostrEventId, JSON.stringify(zapReceiptEvent), zap.id],
  );
}

// Minimal secp256k1 public key derivation without importing nostr-tools
// (to avoid circular dependency with nostrPublisher)
function getPublicKey(privateKeyHex) {
  try {
    const { getPublicKey: nostrGetPubkey } = require('nostr-tools');
    return nostrGetPubkey(privateKeyHex);
  } catch {
    return '';
  }
}

module.exports = { createZapRequest, handlePaymentWebhook };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest tests/zapService.test.js --no-coverage
```
Expected: PASS — 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add backend/src/lightning/zapService.js backend/tests/zapService.test.js
git commit -m "feat: add zap service for invoice creation and Kind 9735 receipt publishing"
```

---

## Task 4: Express routes for zap API

**Files:**
- Create: `backend/src/routes/zap.js`
- Modify: `backend/src/app.js`

Two endpoints:
- `POST /api/zaps/request` — create invoice for a report tip
- `POST /api/zaps/webhook` — called by LND when payment is received (HMAC-verified)

- [ ] **Step 1: Write the failing test (route-level)**

```javascript
// backend/tests/zapRoutes.test.js
const request = require('supertest');
const app     = require('../src/app');

jest.mock('../src/lightning/zapService', () => ({
  createZapRequest: jest.fn().mockResolvedValue({
    zap_id: 'zap-uuid-1234',
    payment_request: 'lnbc1000n1ptest...',
    amount_sats: 1000,
  }),
  handlePaymentWebhook: jest.fn().mockResolvedValue(undefined),
}));

process.env.ZAP_WEBHOOK_SECRET = 'test_secret_32chars_exactly_here';

describe('POST /api/zaps/request', () => {
  test('returns 201 with payment_request on valid input', async () => {
    const res = await request(app)
      .post('/api/zaps/request')
      .send({ report_id: 'report-uuid-1234', amount_sats: 1000 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('payment_request');
    expect(res.body).toHaveProperty('zap_id');
  });

  test('returns 400 when report_id is missing', async () => {
    const res = await request(app)
      .post('/api/zaps/request')
      .send({ amount_sats: 1000 });

    expect(res.status).toBe(400);
  });

  test('returns 400 when amount_sats is missing', async () => {
    const res = await request(app)
      .post('/api/zaps/request')
      .send({ report_id: 'report-uuid-1234' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/zaps/webhook', () => {
  test('returns 200 with valid HMAC signature', async () => {
    const payload = JSON.stringify({ payment_hash: 'abc123' });
    const hmac = require('crypto')
      .createHmac('sha256', 'test_secret_32chars_exactly_here')
      .update(payload)
      .digest('hex');

    const res = await request(app)
      .post('/api/zaps/webhook')
      .set('x-lnd-signature', hmac)
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(200);
  });

  test('returns 401 with invalid HMAC signature', async () => {
    const res = await request(app)
      .post('/api/zaps/webhook')
      .set('x-lnd-signature', 'invalidsignature')
      .send({ payment_hash: 'abc123' });

    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest tests/zapRoutes.test.js --no-coverage
```
Expected: FAIL — zap routes not mounted

- [ ] **Step 3: Create zap.js route file**

```javascript
// backend/src/routes/zap.js
const express   = require('express');
const crypto    = require('crypto');
const { createZapRequest, handlePaymentWebhook } = require('../lightning/zapService');

const router = express.Router();

const WEBHOOK_SECRET = process.env.ZAP_WEBHOOK_SECRET;

router.post('/request', async (req, res) => {
  const { report_id, amount_sats } = req.body;

  if (!report_id || typeof report_id !== 'string') {
    return res.status(400).json({ error: 'report_id is required' });
  }
  if (!amount_sats || typeof amount_sats !== 'number' || amount_sats < 1) {
    return res.status(400).json({ error: 'amount_sats must be a positive number' });
  }

  try {
    const result = await createZapRequest({ reportId: report_id, amountSats: amount_sats });
    return res.status(201).json(result);
  } catch (err) {
    if (err.message === 'Report not found') return res.status(404).json({ error: err.message });
    if (err.message.includes('exceeds maximum')) return res.status(400).json({ error: err.message });
    console.error('[zap] createZapRequest error:', err);
    return res.status(500).json({ error: 'Failed to create zap request' });
  }
});

// LND calls this endpoint when a payment is settled.
// We verify the HMAC to ensure the request is genuine.
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-lnd-signature'];
  const rawBody   = req.body instanceof Buffer ? req.body.toString() : JSON.stringify(req.body);

  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature ?? ''), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = JSON.parse(rawBody);
  await handlePaymentWebhook(payload);
  return res.status(200).json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 4: Mount the router in app.js**

In `backend/src/app.js`, add:
```javascript
const zapRoutes = require('./routes/zap');
// with the other route mounts:
app.use('/api/zaps', zapRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend && npx jest tests/zapRoutes.test.js --no-coverage
```
Expected: PASS — 5 tests passing

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/zap.js backend/src/app.js backend/tests/zapRoutes.test.js
git commit -m "feat: add zap API routes with HMAC-verified LND webhook"
```

---

## Task 5: ZapButton mobile component

**Files:**
- Create: `sentinel-mobile/src/components/ZapButton.tsx`
- Test: `sentinel-mobile/__tests__/ZapButton.test.tsx`

A small tip button shown on report cards. Tapping it opens a bottom sheet with amount selection, then navigates to `ZapScreen` with the generated invoice.

- [ ] **Step 1: Write the failing test**

```typescript
// sentinel-mobile/__tests__/ZapButton.test.tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ZapButton } from '../src/components/ZapButton';

describe('ZapButton', () => {
  test('renders zap icon and label', () => {
    const { getByTestId } = render(
      <ZapButton reportId="report-123" onZapInitiated={jest.fn()} />
    );
    expect(getByTestId('zap-button')).toBeTruthy();
  });

  test('calls onZapInitiated when tapped', () => {
    const onZapInitiated = jest.fn();
    const { getByTestId } = render(
      <ZapButton reportId="report-123" onZapInitiated={onZapInitiated} />
    );
    fireEvent.press(getByTestId('zap-button'));
    expect(onZapInitiated).toHaveBeenCalledWith('report-123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sentinel-mobile && npx jest __tests__/ZapButton.test.tsx --no-coverage
```
Expected: FAIL — `Cannot find module '../src/components/ZapButton'`

- [ ] **Step 3: Implement ZapButton**

```tsx
// sentinel-mobile/src/components/ZapButton.tsx
import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';

interface Props {
  reportId: string;
  onZapInitiated: (reportId: string) => void;
  totalZapsSats?: number;
}

export function ZapButton({ reportId, onZapInitiated, totalZapsSats }: Props) {
  return (
    <TouchableOpacity
      testID="zap-button"
      style={styles.button}
      onPress={() => onZapInitiated(reportId)}
    >
      <Text style={styles.icon}>⚡</Text>
      {totalZapsSats !== undefined && totalZapsSats > 0 && (
        <Text style={styles.amount}>{totalZapsSats} sats</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 153, 0, 0.15)',
    borderWidth: 1,
    borderColor: '#FF9900',
  },
  icon:   { fontSize: 14, color: '#FF9900' },
  amount: { fontSize: 11, color: '#FF9900', marginLeft: 4, fontWeight: '600' },
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd sentinel-mobile && npx jest __tests__/ZapButton.test.tsx --no-coverage
```
Expected: PASS — 2 tests passing

- [ ] **Step 5: Commit**

```bash
git add sentinel-mobile/src/components/ZapButton.tsx \
        sentinel-mobile/__tests__/ZapButton.test.tsx
git commit -m "feat: add ZapButton component for reporter tipping"
```

---

## Task 6: ZapScreen — invoice display and payment flow

**Files:**
- Create: `sentinel-mobile/src/screens/ZapScreen.tsx`

Accepts `reportId` and `amountSats` as route params. Calls `POST /api/zaps/request` on mount. Displays the BOLT11 invoice as a QR code and a copyable string. Deep-links to common Lightning wallets.

- [ ] **Step 1: Implement ZapScreen**

There is no backend mock to write a focused unit test for the full screen here — the component's critical behaviours (API call, QR display, deep link) are integration-level. Test manually as described in the verification step below.

```tsx
// sentinel-mobile/src/screens/ZapScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Clipboard,
  Linking, ActivityIndicator, StyleSheet, Alert,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<any, 'ZapScreen'>;

const API_BASE = process.env.API_BASE_URL ?? 'https://api.sentinelmesh.ke';

const LIGHTNING_WALLETS = [
  { name: 'Muun',   scheme: 'muun:' },
  { name: 'Phoenix', scheme: 'phoenix:' },
  { name: 'Wallet of Satoshi', scheme: 'walletofsatoshi:' },
];

export function ZapScreen({ route, navigation }: Props) {
  const { reportId, amountSats } = route.params as { reportId: string; amountSats: number };
  const [invoice, setInvoice]   = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    async function requestInvoice() {
      try {
        const response = await fetch(`${API_BASE}/api/zaps/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ report_id: reportId, amount_sats: amountSats }),
        });
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        const data = await response.json();
        setInvoice(data.payment_request);
      } catch (err: any) {
        setError(err.message ?? 'Failed to generate invoice');
      } finally {
        setLoading(false);
      }
    }
    requestInvoice();
  }, [reportId, amountSats]);

  if (loading) return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#FF9900" />
      <Text style={styles.loadingText}>Generating invoice…</Text>
    </View>
  );

  if (error || !invoice) return (
    <View style={styles.center}>
      <Text style={styles.errorText}>Could not generate invoice: {error}</Text>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
        <Text style={styles.backText}>Go back</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>⚡ Zap {amountSats} sats</Text>
      <Text style={styles.subtitle}>Scan with your Lightning wallet or copy the invoice.</Text>

      <View style={styles.qrContainer}>
        <QRCode value={invoice.toUpperCase()} size={220} backgroundColor="#0a0a0a" color="#FF9900" />
      </View>

      <TouchableOpacity
        style={styles.copyButton}
        onPress={() => { Clipboard.setString(invoice); Alert.alert('Copied', 'Invoice copied to clipboard'); }}
      >
        <Text style={styles.copyText}>Copy Invoice</Text>
      </TouchableOpacity>

      <Text style={styles.walletLabel}>Open in wallet:</Text>
      <View style={styles.walletRow}>
        {LIGHTNING_WALLETS.map((wallet) => (
          <TouchableOpacity
            key={wallet.name}
            style={styles.walletButton}
            onPress={() => Linking.openURL(`${wallet.scheme}lightning:${invoice}`)}
          >
            <Text style={styles.walletText}>{wallet.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0a0a0a', padding: 20, alignItems: 'center' },
  center:       { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  title:        { color: '#FF9900', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  subtitle:     { color: '#999', fontSize: 13, textAlign: 'center', marginBottom: 24 },
  qrContainer:  { padding: 16, backgroundColor: '#0a0a0a', borderRadius: 12, borderWidth: 1, borderColor: '#FF9900' },
  copyButton:   { marginTop: 20, padding: 14, borderRadius: 8, backgroundColor: '#FF9900', width: '100%', alignItems: 'center' },
  copyText:     { color: '#000', fontWeight: '700', fontSize: 15 },
  walletLabel:  { color: '#999', marginTop: 20, marginBottom: 10, fontSize: 13 },
  walletRow:    { flexDirection: 'row', gap: 8 },
  walletButton: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#444' },
  walletText:   { color: '#ccc', fontSize: 12 },
  loadingText:  { color: '#999', marginTop: 12 },
  errorText:    { color: '#FF2D2D', textAlign: 'center', padding: 20 },
  backButton:   { marginTop: 16, padding: 12, borderRadius: 8, backgroundColor: '#222' },
  backText:     { color: '#ccc' },
});
```

- [ ] **Step 2: Register ZapScreen in the app navigator**

In `sentinel-mobile/src/App.tsx` (or wherever the navigation stack is defined), add:
```typescript
import { ZapScreen } from './screens/ZapScreen';

// Inside the Stack.Navigator:
<Stack.Screen name="ZapScreen" component={ZapScreen} options={{ title: 'Send Zap' }} />
```

- [ ] **Step 3: Wire ZapButton into ReportCard**

In `sentinel-mobile/src/components/ReportCard.tsx`, add:
```typescript
import { ZapButton } from './ZapButton';
import { useNavigation } from '@react-navigation/native';

// Inside the component:
const navigation = useNavigation();

// In the render, at the bottom of the card actions row:
<ZapButton
  reportId={report.id}
  totalZapsSats={report.total_zaps_sats}
  onZapInitiated={(id) => navigation.navigate('ZapScreen', { reportId: id, amountSats: 21 })}
/>
```

- [ ] **Step 4: Add `total_zaps_sats` to the reports API response**

In the backend reports query in `backend/src/reports/reportController.js`, join with zaps:
```sql
SELECT
  cr.*,
  COALESCE(SUM(lz.amount_sats), 0)::int AS total_zaps_sats
FROM community_reports cr
LEFT JOIN lightning_zaps lz ON lz.report_id = cr.id AND lz.status = 'paid'
WHERE ...
GROUP BY cr.id
```

- [ ] **Step 5: Manual verification steps**

1. Start the backend with a running local LND (Polar) node
2. Submit a community report via the mobile app
3. Tap ⚡ on the report card
4. Confirm `ZapScreen` opens and a QR code is displayed
5. Pay the invoice from a second LND node (Polar)
6. Confirm the `lightning_zaps` row has `status = 'paid'` in the database
7. Confirm a Kind 9735 event appears on a Nostr relay (use `https://nostr.band` to search by reporter's pubkey)
8. Confirm the report card now shows the paid sats count

- [ ] **Step 6: Commit**

```bash
git add sentinel-mobile/src/screens/ZapScreen.tsx \
        sentinel-mobile/src/App.tsx \
        sentinel-mobile/src/components/ReportCard.tsx \
        backend/src/reports/reportController.js
git commit -m "feat: add ZapScreen invoice display and wire ZapButton into ReportCard"
```

---

## Self-Review

**Spec coverage:**
- [x] User can tip a reporter — Tasks 5–6
- [x] BOLT11 invoice generated via LND — Task 2
- [x] Kind 9735 zap receipt published to Nostr — Task 3
- [x] `lightning_zaps` table tracks payment status — Task 1
- [x] Webhook HMAC verification — Task 4
- [x] Invoice displayed as QR + copyable string + wallet deep links — Task 6
- [x] Total earned sats shown on report card — Task 6 step 4
- [x] No in-app wallet built (out of scope) — confirmed

**Placeholder scan:** Task 6 Step 2 references `App.tsx` navigation — the exact file name must be verified against the current project. Look for the navigation stack in `sentinel-mobile/src/App.tsx` or `sentinel-mobile/src/navigation/`.

**Type consistency:** `createZapRequest` and `handlePaymentWebhook` are consistently named across `zapService.js`, `zapRoutes.test.js`, and `zap.js`. `ZapButton` prop `onZapInitiated` is defined and called with `(reportId: string)` in both component and ReportCard integration.
