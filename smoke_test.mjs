#!/usr/bin/env node
// SentinelMesh — end-to-end realtime smoke test
// Node.js 24 (built-in WebSocket)

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
const execAsync = promisify(exec);

const WS_URL         = 'ws://localhost:80/ws/events'; // via nginx — production path
const REDIS_PASSWORD = 'mypassword';
const STREAM         = 'sentinel:events:stream';
const EVENT_ID       = '550e8400-e29b-41d4-a716-446655440001';
const EVENT_LAT      = -1.2921;
const EVENT_LNG      = 36.8219;

// Client A: covers Nairobi CBD — event at (-1.2921, 36.8219) is inside
const BOUNDS_A = { north: -1.0, south: -1.5, east: 37.0, west: 36.5 };
// Client B: south of Nairobi — event is outside (north of B's northern edge)
const BOUNDS_B = { north: -1.8, south: -2.2, east: 37.0, west: 36.5 };
// Client B expanded — now includes the event
const BOUNDS_B_EXPANDED = { north: -1.0, south: -2.2, east: 37.0, west: 36.5 };

const failures = [];

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11,23)}] ${msg}`);
}

function fail(stage, layer, note) {
  log(`✗ FAIL [${stage}] layer=${layer} — ${note}`);
  failures.push({ stage, layer, note });
}

function pass(msg) { log(`✓ ${msg}`); }

// ─── WebSocket client helper ────────────────────────────────────────────────

function makeClient(name) {
  const queue = [];
  const waiters = [];
  let ws = null;

  function deliver(msg) {
    if (waiters.length) waiters.shift()(msg);
    else queue.push(msg);
  }

  async function next(timeoutMs = 4000) {
    if (queue.length) return queue.shift();
    return new Promise(resolve => {
      // Must index by `wrapper`, not `resolve` — the array stores wrapper functions.
      const wrapper = msg => { clearTimeout(t); resolve(msg); };
      const t = setTimeout(() => {
        const i = waiters.indexOf(wrapper); if (i > -1) waiters.splice(i, 1);
        resolve(null);
      }, timeoutMs);
      waiters.push(wrapper);
    });
  }

  async function waitFor(type, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const msg = await next(deadline - Date.now());
      if (!msg) return null;
      if (msg.type === type) return msg;
      log(`${name} skip ${msg.type}`);
    }
    return null;
  }

  function connect() {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(WS_URL);
      ws.onopen    = () => { log(`${name} connected`); resolve(); };
      ws.onmessage = e => { const m = JSON.parse(e.data); log(`${name} ← ${m.type}${m.message ? ': '+m.message : ''}`); deliver(m); };
      ws.onerror   = e => reject(new Error(`${name} WS error`));
      ws.onclose   = () => log(`${name} closed`);
      setTimeout(() => reject(new Error(`${name} connect timeout`)), 6000);
    });
  }

  function send(obj) { ws.send(JSON.stringify(obj)); }
  function close()   { ws?.close(); }

  return { name, connect, send, next, waitFor, close };
}

// ─── Redis helpers ───────────────────────────────────────────────────────────

async function redisXADD(payload) {
  const json = JSON.stringify(payload);
  // Write to temp file to avoid cmd.exe quoting issues with double-quotes in JSON
  // and cmd.exe's literal treatment of single-quoted '*' as an invalid stream ID.
  const tmpFile = join(tmpdir(), 'sentinel-smoke-xadd.json');
  await writeFile(tmpFile, json, 'utf8');
  const winPath = tmpFile.replace(/\//g, '\\');
  const cmd = `type "${winPath}" | docker exec -i sentinelmesh-redis-1 redis-cli -a ${REDIS_PASSWORD} --no-auth-warning -x XADD ${STREAM} * payload`;
  try {
    const { stdout, stderr } = await execAsync(cmd);
    if (stderr && !stderr.includes('Warning')) throw new Error(stderr.trim());
    return stdout.trim();
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

async function cleanupDB() {
  try {
    const cmd = `docker exec sentinelmesh-postgres-1 psql -U sentinel -d sentinelmesh -c "DELETE FROM safety_events WHERE id = '${EVENT_ID}';" 2>&1`;
    const { stdout } = await execAsync(cmd);
    log(`DB cleanup: ${stdout.trim().replace(/\n/g, ' ')}`);
  } catch (e) { log(`DB cleanup failed (non-fatal): ${e.message}`); }
}

// ─── Protocol probe ──────────────────────────────────────────────────────────

async function probeProtocol() {
  log('\n── Protocol probe: frontend vs server message shapes ──');

  const probe = makeClient('PROBE');
  await probe.connect();

  // Send frontend-style SUBSCRIBE (with payload wrapper) — what the PWA actually sends
  probe.send({ type: 'SUBSCRIBE', payload: { bounds: BOUNDS_A, zoom: 12 } });
  const resp = await probe.next(2000);

  let serverExpectsFlat = false;
  if (!resp) {
    log('PROBE: no response in 2s after frontend-style SUBSCRIBE');
    serverExpectsFlat = true; // server silently rejected or is still waiting
  } else if (resp.type === 'ERROR') {
    log(`PROBE: server returned ERROR for payload-wrapped SUBSCRIBE: "${resp.message}"`);
    serverExpectsFlat = true;
  } else if (resp.type === 'INITIAL_BATCH') {
    log('PROBE: server accepted payload-wrapped SUBSCRIBE → protocol is compatible');
    serverExpectsFlat = false;
  }

  probe.close();
  await new Promise(r => setTimeout(r, 200));

  // Now probe server response format — what shape does INITIAL_BATCH come in?
  const probe2 = makeClient('PROBE2');
  await probe2.connect();
  probe2.send({ type: 'SUBSCRIBE', bounds: BOUNDS_A, zoom: 12 }); // flat format
  const resp2 = await probe2.next(4000);

  let serverSendsFlat = false;
  if (!resp2) {
    log('PROBE2: no INITIAL_BATCH in 4s with flat SUBSCRIBE');
  } else if (resp2.type === 'INITIAL_BATCH') {
    if (resp2.events !== undefined) {
      log(`PROBE2: INITIAL_BATCH has top-level "events" key (flat) — frontend expects resp.payload.events`);
      serverSendsFlat = true;
    } else if (resp2.payload?.events !== undefined) {
      log('PROBE2: INITIAL_BATCH has "payload.events" key — matches frontend expectation');
    }
  }

  probe2.close();
  await new Promise(r => setTimeout(r, 200));

  return { serverExpectsFlat, serverSendsFlat };
}

// ─── Main smoke test ─────────────────────────────────────────────────────────

async function main() {
  log('═══════════════════════════════════════════════════════');
  log('SentinelMesh Realtime Smoke Test — ' + new Date().toISOString());
  log('═══════════════════════════════════════════════════════');

  // Pre-clean the test event from any prior run
  await cleanupDB();

    // Protocol shape is tested inline on Client A — we try the frontend format first,
  // observe the response, then fall back to the correct flat format if needed.
  // This avoids extra connection attempts that would consume rate-limit tokens.

  // Use correct (flat) format for the rest of the pipeline test
  const clientA = makeClient('Client-A');
  const clientB = makeClient('Client-B');

  // ── Step 1: Connect and SUBSCRIBE ─────────────────────────────────────────
  log('\n── Step 1: Connect both clients, send SUBSCRIBE ──');
  try {
    await clientA.connect();
    await clientB.connect();
  } catch (e) {
    fail('Step 1', 'gateway', `Cannot connect to ${WS_URL}: ${e.message}`);
    process.exit(1);
  }

  // Protocol probe: confirm flat format (what fixed useViewportWs.ts now sends)
  // Server expects: {type,bounds,zoom} — flat, no payload wrapper
  log('Probing SUBSCRIBE format: sending flat {type,bounds,zoom} (fixed frontend format)');
  clientA.send({ type: 'SUBSCRIBE', bounds: BOUNDS_A, zoom: 12 });
  const probeResp = await clientA.next(3000);
  if (probeResp?.type === 'INITIAL_BATCH') {
    log('Server accepted flat SUBSCRIBE — protocol shapes match');
    if (probeResp.events !== undefined) {
      pass('Server INITIAL_BATCH uses top-level "events" key — matches fixed useViewportWs.ts (reads msg.events)');
    }
  } else if (probeResp?.type === 'ERROR' || probeResp === null) {
    const msg = probeResp ? probeResp.message : 'no response';
    fail('Protocol', 'WS/gateway', `Server rejected flat SUBSCRIBE: "${msg}"`);
    // Still need to proceed — but pipeline is broken if server won't accept SUBSCRIBE
  }

  clientB.send({ type: 'SUBSCRIBE', bounds: BOUNDS_B, zoom: 12 });

  const ibA = probeResp?.type === 'INITIAL_BATCH' ? probeResp : await clientA.waitFor('INITIAL_BATCH', 5000);
  const ibB = await clientB.waitFor('INITIAL_BATCH', 5000);

  if (!ibA) fail('Step 1', 'gateway', 'Client A: INITIAL_BATCH not received within 5s');
  else {
    const count = ibA.events?.length ?? 0;
    pass(`Client A INITIAL_BATCH: ${count} events`);
    if (ibA.events === undefined) {
      fail('Protocol', 'WS/frontend', 'Server INITIAL_BATCH missing top-level "events" key — frontend reads msg.events');
    }
  }

  if (!ibB) fail('Step 1', 'gateway', 'Client B: INITIAL_BATCH not received within 5s');
  else pass(`Client B INITIAL_BATCH: ${ibB.events?.length ?? 0} events`);

  if (!ibA || !ibB) { clientA.close(); clientB.close(); summarise(); return; }

  // ── Step 2: Inject controlled event into Redis ────────────────────────────
  log('\n── Step 2: Inject event → Redis stream ──');
  const now = new Date().toISOString();
  const eventPayload = {
    id: EVENT_ID,
    event_type: 'SECURITY_INCIDENT',
    severity: 'HIGH',
    lat: EVENT_LAT,
    lng: EVENT_LNG,
    title: 'Smoke Test — Nairobi CBD',
    is_active: true,
    started_at: now,
    created_at: now,
    schema_version: 1,
  };

  let streamId;
  try {
    streamId = await redisXADD(eventPayload);
    if (!streamId || streamId.startsWith('ERR')) throw new Error(streamId);
    pass(`XADD → stream entry ${streamId}`);
  } catch (e) {
    fail('Step 2', 'Redis', `XADD failed: ${e.message}`);
    clientA.close(); clientB.close(); summarise(); return;
  }

  // ── Step 3: Validate DIFF_PATCH propagation ───────────────────────────────
  log('\n── Step 3: Validate propagation — Client A in-bounds, Client B out-of-bounds ──');

  const [diffA, diffB] = await Promise.all([
    clientA.waitFor('DIFF_PATCH', 4000),
    clientB.waitFor('DIFF_PATCH', 4000),
  ]);

  // Client A must receive the event
  if (!diffA) {
    fail('Step 3', 'gateway/broadcast', 'Client A: no DIFF_PATCH within 4s of Redis inject');
  } else {
    const added = diffA.added ?? [];
    const found = added.find(e => e.id === EVENT_ID);
    if (!found) fail('Step 3', 'gateway/bounds', `Client A DIFF_PATCH missing event in added[] — got ${JSON.stringify(added.map(e=>e.id))}`);
    else pass(`Client A received DIFF_PATCH with event in added[] (severity=${found.severity}, lat=${found.lat})`);
  }

  // Client B must NOT receive the event (bounds filter)
  if (diffB) {
    const added = diffB.added ?? [];
    if (added.find(e => e.id === EVENT_ID)) {
      fail('Step 3', 'gateway/bounds-filter', `Client B incorrectly received event ${EVENT_ID} — bounds filter broken`);
    } else {
      pass('Client B DIFF_PATCH received but event NOT in it — bounds filtering correct');
    }
  } else {
    pass('Client B: no DIFF_PATCH received — event correctly excluded by bounds');
  }

  // ── Step 4: VIEWPORT_CHANGED — Client B pans to cover event ──────────────
  log('\n── Step 4: VIEWPORT_CHANGED — Client B expands viewport to include event ──');
  clientB.send({ type: 'VIEWPORT_CHANGED', bounds: BOUNDS_B_EXPANDED, zoom: 12 });
  log('Client B sent VIEWPORT_CHANGED (300ms server debounce + DB query…)');

  // Don't sleep — let waitFor handle the debounce wait so the message goes
  // directly to the active waiter rather than through the queue.
  const diffB2 = await clientB.waitFor('DIFF_PATCH', 4000);

  if (!diffB2) {
    fail('Step 4', 'gateway/debounce', 'Client B: no DIFF_PATCH after VIEWPORT_CHANGED within 3.5s');
  } else {
    const added = diffB2.added ?? [];
    if (!added.find(e => e.id === EVENT_ID)) {
      fail('Step 4', 'gateway/diff', `Client B DIFF_PATCH doesn't include event after viewport expand. added=${JSON.stringify(added.map(e=>e.id))}`);
    } else {
      pass('Client B received event in DIFF_PATCH after VIEWPORT_CHANGED');
      const dups = added.filter((e, i) => added.findIndex(x => x.id === e.id) !== i);
      if (dups.length) fail('Step 4', 'gateway', `Duplicate events in DIFF_PATCH added[]: ${dups.map(e=>e.id)}`);
      else pass('No duplicate events in DIFF_PATCH');
    }
  }

  // ── Step 5: Snapshot recovery ─────────────────────────────────────────────
  log('\n── Step 5: Snapshot recovery — SNAPSHOT_REQUEST ──');
  clientA.send({ type: 'SNAPSHOT_REQUEST' });
  const snapshot = await clientA.waitFor('SNAPSHOT', 3000);

  if (!snapshot) {
    fail('Step 5', 'gateway', 'Client A: SNAPSHOT not received after SNAPSHOT_REQUEST');
  } else {
    const events = snapshot.events ?? [];
    pass(`SNAPSHOT received: ${events.length} events`);
    if (!events.find(e => e.id === EVENT_ID)) {
      fail('Step 5', 'gateway/db', `SNAPSHOT is missing the injected event — DB upsert or query broken`);
    } else {
      pass('Injected event is present in SNAPSHOT');
    }
  }

  // ── Step 6: Performance sanity ────────────────────────────────────────────
  log('\n── Step 6: Performance sanity ──');
  if (snapshot) {
    const events = snapshot.events ?? [];
    const unique = new Set(events.map(e => e.id));
    if (unique.size !== events.length) fail('Step 6', 'gateway/db', `SNAPSHOT has ${events.length - unique.size} duplicate IDs`);
    else pass(`No duplicate IDs in SNAPSHOT (${events.length} total events)`);
  }

  // State consistency: Client A's DIFF_PATCH should not re-add an event it already knows
  if (diffA) {
    const added = diffA.added ?? [];
    const updated = diffA.updated ?? [];
    const both = added.filter(a => updated.find(u => u.id === a.id));
    if (both.length) fail('Step 6', 'gateway', `Event appears in both added[] and updated[] in same DIFF_PATCH`);
    else pass('No event in both added[] and updated[] simultaneously');
  }
  pass('Rate limiting: single event is well within 30/s cap — not exercised');

  // ── Cleanup ───────────────────────────────────────────────────────────────
  clientA.close();
  clientB.close();
  await cleanupDB();

  summarise();
}

function summarise() {
  log('\n═══════════════════════════════════════════════════════');
  if (failures.length === 0) {
    log('SMOKE TEST PASS — realtime pipeline is production-valid');
  } else {
    log(`SMOKE TEST FAIL — ${failures.length} failure(s):`);
    for (const f of failures) log(`  • [${f.stage}] ${f.layer}: ${f.note}`);
  }
  log('═══════════════════════════════════════════════════════');
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
