# SentinelMesh — Brutal Enterprise, Security, Privacy & Adoption Audit

Date: 2026-06-03 · Branch: `feat/zap-hardening` · Method: direct source inspection (no claims trusted).
Scope verified by reading: gateway (auth, reports, circles, location blobs, zaps, push, WS, config, subscribers), sentinel-core crypto, blockchain anchor worker, signal NLP, PWA (e2ee, nostr, photo, report submit), Postgres schema, README claims.

---

## 1. Executive Summary

SentinelMesh is a competently built **prototype** with real, working primitives (NIP-98 auth with replay guard, constant-time internal auth, genuine Bitcoin OP_RETURN construction, WebCrypto AES-GCM + X25519, on-device EXIF strip + face blur). The engineering quality of individual modules is above average for an early-stage project.

**But its headline privacy and trust claims are false or misleading, and its trust model has no Sybil resistance.** As safety-critical software it is **not production-ready** and, deployed as-is into a real emergency context, it could cause harm: it can be trivially driven to fabricate "verified" incidents, suppress real ones, blast every user's device with every incident's precise coordinates, and it stores a re-identifiable movement history in plaintext while telling users it does not.

Verdict: **promising prototype, dangerous if shipped as advertised.** The gap between what the README promises and what the code does is the single biggest risk.

---

## 2. Top Critical & High Findings

Severity: 🔴 Critical · 🟠 High · 🟡 Medium

### 🔴 C-1 — Consensus has zero Sybil resistance (trust model is fake)
`reports/consensus.rs`: status is a flat vote count. 3 confirmations → `UNVERIFIED`, 7 → `VERIFIED`, 15 → `AUTHORITATIVE`; −5 → `REJECTED`. Identities are free, unlimited, self-generated Nostr keys (`nostrService.ts`). `report_votes` is `UNIQUE(report_id, voter_pubkey)` — one vote per *key*, not per *person*.
**Impact:** 3 sock-puppets verify any fake incident; 5 suppress any true one. Crossing score 3 also **auto-queues a Bitcoin anchor** and a push blast. This is the core of the product and it is unprotected.
**Worst case:** fabricated "SECURITY_INCIDENT/FIRE" reaches AUTHORITATIVE → mass panic, bad evacuation; real incident down-voted → no warning.

### 🔴 C-2 — "The server never stores readable location data" is FALSE
`infra/postgres/init.sql`: `community_reports.lat/lng`, `report_votes.voter_lat/voter_lng`, and `safety_events.lat/lng` are stored as plaintext `DECIMAL`, tied to a persistent `nostr_pubkey` (`idx_reports_pubkey` indexes exactly that). Only family-circle `location_blobs` are encrypted.
**Impact:** the server (and anyone who breaches it or reads the public reports API) gets a timestamped movement trail per identity. Directly contradicts README "Privacy rules (never broken)."

### 🔴 C-3 — Full social graph stored in plaintext
`circles` / `circle_members` store `owner_pubkey`, `member_pubkey`, `display_name` in clear. The server can reconstruct who is connected to whom, household composition, and (via `location_blobs.circle_id` + `recipient_pubkey_hash` + timing) who shares location with whom and when.
**Impact:** contradicts "server cannot infer social graphs." A single DB dump exposes the relationship graph of every family — catastrophic in an adversarial-government / domestic-abuse context.

### 🔴 C-4 — Push: unauthenticated subscribe + untargeted global broadcast
`routes/push.rs`: `/push/subscribe` has **no auth** — anyone can register subscriptions under any pubkey or flood the table. `broadcast_push` selects **every row** and sends each event (with `lat/lng` to 4 decimals ≈ 11 m) to **all** subscribers. `event_subscriber.rs:217` calls it for every event. There is no proximity/circle/severity targeting despite "proximity alerts."
**Impact:** every user's device receives the precise location of every incident anywhere → alert fatigue (people mute → miss real alerts), mass privacy leak, and a built-in spam/DoS amplifier. The send loop is sequential `await` per subscriber → also a scaling wall (see S-1).

### 🔴 C-5 — Insecure default for the internal service secret
`config.rs`: `INTERNAL_SERVICE_SECRET` falls back to the literal `"dev-only-insecure-secret"` with only a `warn!` if unset. Internal-only endpoints (blockchain callbacks, etc.) are then bypassable by anyone who reads the source.
**Fix posture:** must fail closed (refuse to start) in production.

### 🔴 C-6 — IPFS (Pinata) JWT shipped in the browser bundle
`photoService.ts`: `import.meta.env['VITE_PINATA_JWT']`. All `VITE_*` vars are inlined into the client bundle → the Pinata credential is downloadable by every user.
**Impact:** anyone can pin arbitrary content to your account (cost, abuse, illegal-content liability).

### 🔴 C-7 — Bitcoin anchoring proves the wrong thing ("tamper-proof" is misleading)
`crypto.rs` + `bitcoin_anchor.rs`: the OP_RETURN commits `SHA256({event_id, nostr_event_id, severity})` only. It does **not** commit `lat/lng`, `description`, `title`, or time. An operator can rewrite a report's location/description in Postgres and the anchor still "matches."
**Impact:** the "permanent, tamper-proof record" is an integrity theater — it anchors an identifier triple, not the safety-relevant content. Also see S-3 (cost/scale) and A-1 (fee-drain).

### 🟠 H-1 — `recipient_pubkey_hash` provides no anonymity
`location_blobs.rs`: recipient is `SHA256(pubkey)`. Nostr pubkeys are public, so anyone (incl. the server) can precompute hash→pubkey for known users. Combined with `sender_ephemeral_pubkey`, `circle_id`, and timestamps, the server sees the **full location-sharing communication graph and timing** — only the coordinate payload is hidden.
**Verdict on "encrypted blob it can never read":** content TRUE, **metadata FALSE**.

### 🟠 H-2 — Circle key: extractable, in localStorage, never rotated
`e2eeService.ts`: AES-256 circle key exported raw and stored base64 in `localStorage` (`extractable: true`). Any XSS exfiltrates it. On member removal the key is **not** rotated, so removed members retain the ability to decrypt any ciphertext they can still observe. No forward secrecy.

### 🟠 H-3 — Identity is ephemeral by default; no recovery
`nostrService.ts`: without a NIP-07 extension the keypair lives in memory only and is **regenerated on page refresh**. That silently changes the user's pubkey → breaks circle membership, reputation/tier, and zap attribution. Lost key = lost circles, no recovery path. Major adoption blocker and a safety risk (you lose your family circle exactly when you need it).

### 🟠 H-4 — Report signatures don't bind report content; no replay guard
`routes/reports.rs::verify_nostr_event`: verifies the Nostr event's signature, pubkey match, and freshness (≤300 s) — but the signed event content is **not** bound to `lat/lng/report_type/description`. The signature proves key possession + recency only. There is no per-event replay guard (unlike the NIP-98 path), so one signed event can back many reports within the window. Combined with C-1 → cheap spam at scale.

### 🟠 H-5 — "NLP misinformation detection" is a keyword counter
`signal/nlp/classifier.py`: 3 keyword hits = "full confidence." No negation ("no fire, all clear" → FIRE), no context, no ML. `confidence` is meaningless. This feeds `safety_events` shown on the public map.
**Impact:** false positives and trivial poisoning of the automated event feed.

### 🟠 H-6 — Rate limiting is per-process and Sybil-bypassable
`routes/reports.rs` (DashMap) and zap/acoustic (in-memory `governor`) reset on restart and are **not shared across replicas**. Keyed on pubkey (free to mint) OR IP (only when `trust_proxy`). Horizontal scaling silently multiplies all limits.

### 🟠 H-7 — In-process workers duplicate across replicas
`main.rs` spawns synthesis (5 s), receipt-retry (60 s), invoice-expiry (5 min) inside every gateway instance. `publish_jobs` uses row locking (safe), but `synthesis_worker` writing `public_events` has no leader election → duplicate clusters/inserts when you run >1 gateway.

### 🟠 H-8 — Single hot anchoring wallet + auto-anchor fee-drain
`blockchain/config.rs`: `BITCOIN_WIF` (hot key) signs every anchor. Because consensus≥3 auto-queues an anchor (C-1), attackers can fabricate consensus to make you broadcast real on-chain txs → **drain the wallet via fees**. Per-report on-chain anchoring also doesn't scale (S-3).

### 🟠 H-9 — Zap webhook trusts itself; receipt mislabels preimage
`zap.rs`/`zap_service.rs`: HMAC is constant-time (good), but a paid status is written purely on the webhook's say-so with **no LND `lookupinvoice` settlement check** — webhook-secret compromise = forge arbitrary payments. Separately, `publish_zap_receipt` is passed `payment_hash` into the `preimage` tag → NIP-57 receipts are semantically wrong.

### 🟠 H-10 — Face blur is best-effort; IPFS is permanent & public
`photoService.ts` uses BlazeFace (frontal-only) — misses profiles, partial, crowd, low-light faces. EXIF strip via canvas re-encode does work. But output goes to **public, immutable IPFS**; any missed face is an irreversible exposure, and the CID is linkable (report → pubkey → location).

### 🟡 Medium
- **M-1** Duplicate blockchain implementations: live Rust + ~1,514 LOC dead TypeScript (drift/attack surface). Remove the TS tree.
- **M-2** `LND_TLS_SKIP_VERIFY` env footgun (MITM to LND if enabled).
- **M-3** CORS `allow_origin(Any)` + unauthenticated write endpoints.
- **M-4** Event schema duplicated 3× (`shared/contracts` + 2 services) — drift risk.
- **M-5** No consent to be added to a circle; `get_circle` returns full member list (enumeration/harassment).
- **M-6** "No personal data collected" is misleading: a stable pubkey + plaintext location history is personal/identifiable data under GDPR.

---

## 3. Privacy Audit — claim-by-claim verdict
| README claim | Verdict | Why |
|---|---|---|
| "Server never stores readable location data" | **FALSE** | community_reports / report_votes / safety_events store plaintext lat/lng (C-2) |
| "All family-circle coordinates encrypted on-device (AES-256-GCM)" | **TRUE** | `e2eeService.ts` — correct AES-GCM, random 12-byte IV, X25519 wrap |
| "Server only stores a blob it can never read" | **PARTIALLY TRUE** | content yes; **metadata graph + timing exposed** (H-1, C-3) |
| "Server cannot infer social graphs" | **FALSE** | circles/members plaintext (C-3) |
| "No personal data collected" | **MISLEADING** | stable pseudonym + location trail = personal data (M-6) |
| "Photos processed on-device, EXIF stripped, faces blurred" | **PARTIALLY TRUE** | EXIF strip works; face blur is frontal-only best-effort (H-10) |
| "Permanent, tamper-proof Bitcoin record" | **MISLEADING** | anchors an id triple, not content (C-7) |

---

## 4. Security Audit (summary)
- **Auth:** NIP-98 implementation is solid — kind/timestamp/window/URL/method binding + Redis replay guard, fails closed on Redis loss. Internal auth uses constant-time compare. Good. **But** the insecure default secret (C-5) and unauthenticated push subscribe (C-4) undermine it.
- **Injection:** all SQL is parameterized via sqlx — no SQLi found. No command injection / unsafe deserialization observed. No `unsafe` Rust in the paths reviewed.
- **Secrets:** none hardcoded in tracked source; `.env` is gitignored (confirmed not tracked). Weaknesses are runtime defaults (C-5) and the client-bundled IPFS JWT (C-6).
- **Abuse/Sybil:** the dominant gap (C-1, H-4, H-6). The whole reporting/voting economy is free to forge.

## 5. Cryptography Audit (summary)
Primitives are used correctly where present (AES-GCM random IV, X25519 ECDH, secp256k1 sighash/witness, HMAC constant-time). The problems are **model-level**: key storage/rotation (H-2), ephemeral identity & recovery (H-3), content-binding of signatures (H-4), anchor semantics (C-7), and receipt correctness (H-9). No homemade crypto — good.

## 6. Public Safety Audit — worst realistic outcome per feature
| Feature | If it fails… |
|---|---|
| Community reports + consensus | Fabricated incident "verified" → panic & misrouted evacuation; true incident suppressed → no warning (C-1) |
| Push alerts | Global blast → fatigue → users mute → miss the real one; leaks every location (C-4) |
| NLP event feed | False classification posts phantom incidents to the public map (H-5) |
| Escape routes | Routes computed from poisoned events lead **into** danger / away from safety |
| Family circles | Lost ephemeral key mid-emergency → can't reach family; social graph breach enables targeting (H-3, C-3) |
| Acoustic detection | Speaker playback / model naïveté → mass false alerts (rate-limited 5/min/key, Sybil-bypassable) |
| Bitcoin anchoring | False "verified, on Bitcoin" trust signal on alterable content (C-7) |

## 7. Scalability Audit
- **S-1 — first wall (~10k–50k):** single-process WS fanout (tokio broadcast to N subscribers per event, bound to one gateway); a DB geo-query **per viewport change** (`query_viewport_events`) hammers Postgres on map panning; per-process rate limiters and duplicate workers break on scale-out (H-6, H-7); push send loop is sequential awaits over all subscribers.
- **S-2 — second wall (~100k–1M):** push broadcast is O(all subscribers) single-threaded → falls hours behind; default single relay `wss://nos.lol` is a SPOF; single-region Postgres write ceiling.
- **S-3 — ceiling:** per-report Bitcoin anchoring is impossible at scale (≈7 tx/s global, 10-min blocks, real fees). Must batch into periodic Merkle digests (the `blockchain_anchors` table already hints at this with `period_start/end/event_count` — unused by the live path).

## 8. Legal Audit
- **GDPR / UK GDPR / Kenya DPA:** plaintext location tied to a stable identifier is personal data → needs lawful basis, DPIA (high-risk location + vulnerable users), and data-subject rights. **Right to erasure is structurally impossible**: data lands on Nostr relays (replicated), IPFS (immutable, public), and Bitcoin (immutable). This is a design-level conflict, not a checkbox.
- **DSA:** user-generated reports with no notice-and-action / moderation / appeal flow.
- **Child safety:** no age gating; minors' locations could be shared in circles.
- **Verdict:** current privacy model is **not** sufficient for EU/UK/KE deployment.

## 9. Adoption Audit
Ordinary families: blocked by H-3 (identity vanishes on refresh) and key-management friction. NGOs/journalists in hostile environments: blocked by C-3 (plaintext social graph) — this is the exact population for whom that leak is lethal. Emergency responders/governments: blocked by C-1 (no way to trust reports) and H-5 (junk NLP feed). **Before adoption is realistic:** persistent recoverable identity, real Sybil resistance, targeted alerts, honest privacy docs, and a moderation/trust layer.

## 10. Competitive Analysis
- **Citizen / Watch Duty:** curated/verified sources → trustworthy alerts. SentinelMesh's open consensus is its differentiator **and** its biggest liability (C-1).
- **Life360:** persistent identity + recovery + targeted alerts — areas where SentinelMesh currently regresses (H-3, C-4).
- **Ushahidi:** mature crowd-report moderation — SentinelMesh lacks the moderation layer.
- **Genuine moat:** Nostr identity + Bitcoin anchoring + on-device E2EE for circles is a real, defensible differentiator **once the claims are true and Sybil resistance exists.** Today the moat is mostly narrative.

## 11. Production Readiness Scorecard (0–10)
| Dimension | Score | Note |
|---|---|---|
| Security | 4 | Good auth core; undercut by C-4, C-5 |
| Privacy | 3 | Headline claims false (C-2, C-3, H-1) |
| Cryptography | 5 | Primitives fine; model/claims wrong |
| Abuse Resistance | 2 | No Sybil resistance (C-1, H-4, H-6) |
| Reliability | 4 | Duplicate workers, SPOF relay |
| Scalability | 3 | WS/push/anchor walls |
| Safety | 3 | Fabricate/suppress/panic vectors |
| Observability | 4 | Sentry + tracing; no metrics/alerting seen |
| Operations | 4 | Compose only; no DR/HA evident |
| Legal Readiness | 2 | Erasure structurally impossible |
| Production Readiness | 3 | Prototype |
| Adoption Readiness | 4 | Identity + trust blockers |

## 12. Final Verdict
- **Impressive:** NIP-98 auth, real Bitcoin tx building, clean Rust, on-device E2EE + EXIF strip, honest test coverage.
- **Overstated:** "never stores readable location," "cannot infer social graph," "tamper-proof," "proximity alerts," "NLP."
- **Dangerous:** open consensus driving verified status + auto-anchor + global push; plaintext social graph; global location blast.
- **Missing:** Sybil resistance, persistent/recoverable identity, alert targeting, moderation, batched anchoring, cross-replica infra, honest privacy posture.
- **Fails first:** the consensus trust model and the push fanout.

---

# Remediation Plan

## Phase 0 — Immediate (block public launch; 1–2 weeks)
1. **Stop overclaiming.** Rewrite README privacy rules to match reality *now* (C-2, C-3, C-7, H-1). Non-negotiable for trust/legal.
2. **C-5:** make `INTERNAL_SERVICE_SECRET`, `ZAP_WEBHOOK_SECRET` fail-closed — refuse to boot in `NODE_ENV=production` if unset/default.
3. **C-6:** remove `VITE_PINATA_JWT` from the client. Proxy IPFS pinning through an authenticated gateway endpoint; rotate the leaked JWT.
4. **C-4 (stop the bleed):** add NIP-98 auth to `/push/subscribe`; change `broadcast_push` to target by circle/proximity/severity; drop precise coords from push body (use place name or coarse geohash).
5. **H-8:** decouple Bitcoin anchoring from raw consensus count; gate anchoring behind a moderated/tiered threshold and a per-day spend cap.
6. **M-1:** delete the dead TypeScript blockchain tree.

## Phase 1 — Pre-public deployment (4–8 weeks)
7. **C-1 Sybil resistance:** weight votes by reputation tier; require proof-of-uniqueness for trust escalation (e.g. NIP-05/domain attestation, web-of-trust, optional phone/PoW for tier-up); make `VERIFIED` require diverse, established keys, not raw count. Add geographic plausibility (voter near report).
8. **H-4:** bind the Nostr signature to a canonical hash of the report content (lat/lng/type/desc/ts); add a per-event replay guard like the NIP-98 path.
9. **C-2/C-3 privacy redesign:** stop storing plaintext social graph and precise report location tied to a stable key. Options: coarsen/jitter public-report coordinates, hash+salt or tokenize membership, separate identity-linked data behind stricter access, support rotating per-context keys.
10. **H-2:** store the circle key non-extractably (IndexedDB `CryptoKey`, `extractable:false`); rotate the circle key on member removal (re-wrap to remaining members).
11. **H-3:** persistent, recoverable identity — encrypted-at-rest local key with passphrase, push to use NIP-07, and an explicit backup/restore (nsec export + warning, or NIP-49). Never silently regenerate.
12. **H-9:** verify settlement via LND `lookupinvoice` before marking paid; fix the preimage vs payment_hash bug in the receipt.
13. **H-5:** label the NLP output as low-confidence heuristic; never auto-promote keyword hits to map events without human/consensus review; add negation handling at minimum.
14. **H-10:** warn users blur is best-effort; consider server-side re-scan; reconsider permanent public IPFS for incident photos (private/expI­ring storage instead).

## Phase 2 — Pre-100k users (reliability & scale)
15. **H-6:** move rate limiting to Redis (shared, atomic) keyed by IP+identity tier.
16. **H-7:** extract synthesis/retry/expiry into a dedicated worker service or add leader election (advisory lock) so only one runs.
17. **S-1:** cache/debounce viewport queries; add a tile/aggregation layer; cap WS connections per node and add horizontal WS sharding by region.
18. **C-4 scale:** replace the sequential push loop with a queued, concurrent, batched fanout (web-push pool) and per-region targeting.
19. Observability: add metrics (Prometheus), dashboards, and alerting; load-test the WS + push paths.

## Phase 3 — Pre-1M users (architecture)
20. Partition/shard Postgres (or move hot geo data to PostGIS + read replicas); regionalize.
21. Run multiple Nostr relays (own + redundant) — remove the `nos.lol` SPOF.
22. Push via a dedicated notification service (FCM/APNs bridge or queue workers) decoupled from event ingest.

## Phase 4 — Pre-mainnet Bitcoin anchoring
23. **C-7/S-3:** anchor a **Merkle root of a batch** of events on a schedule (the `blockchain_anchors` period_* fields), and commit the **content** (lat/lng/desc/ts), not just an id triple. Publish inclusion proofs so anyone can verify a specific event.
24. **H-8 key custody:** move `BITCOIN_WIF` to an HSM/signing service; hot wallet holds minimal funds; strict daily/again-gated spend caps; monitor wallet balance.
25. Legal sign-off on immutability vs erasure (anchor only non-personal hashes; document why this is GDPR-compatible).

---

# Addendum — Acoustic Detection Path (end-to-end verified)

**Chain traced:** `audioCapture.ts` (getUserMedia 16 kHz AudioWorklet, **only while tab is visible**) → `acousticDetectionService.ts` (YAMNet loaded from **tfhub.dev**) → `getThreatFromScores` (threshold 0.80, 10 mapped classes incl. Gunshot/Explosion) → `useAcousticEngine.ts` (`getCurrentPosition` → submit) → `acousticSignalSubmit.ts` (NIP-98-signed POST with **client-asserted** label+confidence+exact lat/lng) → `routes/acoustic.rs` (auth, 5/min/key, range-validate, H3 r9/r7, insert `pending`) → `synthesis_worker.rs` (5 s tick) → `public_events` → WS broadcast to the map.

### 🔴 AC-1 — Server trusts client-asserted detections (on-device model is advisory only)
`acoustic.rs` validates only that `confidence ∈ [0,1]` and coords are in range. `threat_class` and `confidence` are whatever the client sends. A malicious client **skips audio entirely** and POSTs `{threat_class:"Gunshot", confidence:0.99, lat,lng}` with any freshly generated Nostr key. Nothing proves a sound occurred.

### 🔴 AC-2 — Two free Sybil keys = instant CONFIRMED event
`synthesis_worker.rs`: `MIN_CONTRIBUTORS = 2`, and `CORROBORATE_THRESHOLD == CONFIRM_THRESHOLD == 0.60`. The client only emits detections at `confidence ≥ 0.80`, so the trust-weighted average is always ≥ 0.80 > 0.60. Result: **any 2 distinct pubkeys** reporting the same `threat_class` in the same ~100 m H3 cell within 120 s → promoted straight to `confirmed` in one tick → `public_events` row at severity HIGH/CRITICAL → broadcast to every map client (and, via C-4, pushed to every device). The two-stage trust ladder is cosmetic.

### 🔴 AC-3 — Speaker-playback spoofing works against honest clients too
YAMNet @ 0.80 + 2 nearby phones running the app: fireworks, a car backfire, a movie gunshot, or a deliberately played clip produces **genuine** detections → confirmed "Gunshot/Explosion" → panic. There is no anti-spoofing of any kind.

### 🟠 AC-4 — Anti-spoof / provenance is vaporware
`signal_fingerprint` is **never set by the client** (always NULL), and the synthesis worker contains **no** fingerprint, sensor-independence, or DBSCAN logic. Yet `lineage` hardcodes `"antispoof-v1"`, `"dbscan-h3-v1"`, `"sensor_independence_version"`. The provenance metadata describes capabilities that do not exist.

### 🟠 AC-5 — Documented retention control is not implemented
`008_synthesis.sql` comments + ADR-001 promise a "nightly job" that nulls exact lat/lng after 24 h and `h3_r9` after 7 days. **No such job exists** — `main.rs` spawns only the redis subscriber, receipt-retry, invoice-expiry, and synthesis workers. Exact coordinates + pubkey persist indefinitely → a movement trail per identity (same class of issue as C-2). Documented privacy control ≠ reality.

### 🟠 AC-6 — Signal payload is not authenticated
The NIP-98 auth event has empty content and only `u`/`method` tags — it proves a key called the endpoint, not that the key asserted *these* coordinates/class/confidence. No content binding (same pattern as H-4).

### 🟠 AC-7 — Confirmed acoustic events never expire or retract
`acoustic_signals` expire only in `pending`/`corroborating` after 300 s; `confirmed` signals and `public_events` have **no TTL and no dispute/expire path** in the worker (`expired_at` column unused). One false confirmed event stays `ACTIVE` on the map indefinitely.

### 🟡 AC-8 — Detection only runs while the tab is foreground
`useAcousticEngine` stops capture on `visibilitychange → hidden`. Useless for real ambient detection (phone in pocket, screen off, app backgrounded) — undermines the core value proposition.

### 🟡 AC-9 — "Trust-weighted" is uniform
`DEFAULT_TRUST = 0.40` for every node; the per-node reputation is unimplemented (index exists, worker absent). The 25 % per-pubkey cap only bites at >4 contributors — never on the 2-contributor confirm path.

### 🟡 AC-10 — Remote model dependency
YAMNet is fetched from `tfhub.dev` each session — availability + supply-chain dependency; on a censored/offline network detection silently fails (`catch → console.warn`).

**Privacy verdict on "on-device audio inference":** **TRUE** that raw audio never leaves the device (only label+confidence+location are sent) — but the location is exact and identity-linked, retention is unenforced (AC-5), and the result is unverifiable and trivially spoofable (AC-1/2/3).

### Acoustic remediation (folds into the main plan)
- Server-side plausibility: require ≥3 **independent** contributors, raise/separate corroborate vs confirm thresholds, weight by real reputation, and add geographic/temporal independence checks (Phase 1, with C-1).
- Actually populate and verify `signal_fingerprint` (audio embedding/hash) to detect identical-source replay; or stop claiming anti-spoof.
- Implement the ADR-001 retention job (or remove the claim) (AC-5).
- Add `public_events` TTL + dispute/expire path (AC-7).
- Bind the signal payload into the signed event (AC-6).
- Be honest that detection is foreground-only, or move to a background-capable architecture (AC-8).
- Self-host the model (AC-10).

## Legal track (parallel)
26. DPIA for location processing; document lawful basis; publish a real privacy policy reflecting C-2/C-3/H-1; design an erasure story given Nostr/IPFS/Bitcoin immutability (anchor only non-personal digests; keep personal data in erasable stores). Age-gating + moderation/notice-and-action for DSA.
