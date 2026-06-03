# H-5 — NLP Guardrails: negation handling + trust ladder (Design)

Date: 2026-06-04
Audit ref: H-5 ("NLP misinformation detection is a keyword counter"), FINAL-audit-report.md
Branch goal: close the H-5 audit findings only. No acoustic refactor, no community-report
promotion changes. Keep forward-compatible with a later unified trust-engine migration.

## Problem

The NLP path auto-promotes a single keyword hit straight to a trusted public map event:

`services/signal/nlp/classifier.py` counts substring keyword hits (3 hits = "full confidence")
with no negation and no context, so "no fire, all clear" classifies as FIRE. That signal is
built into an event from a **single source** (`build_event([signal])`) and emitted to Redis.
`services/gateway/src/subscribers/event_subscriber.rs` then inserts it into `safety_events`,
broadcasts it to the map as `trust_state: "confirmed"`, and fires **push notifications** for
HIGH/CRITICAL — all from one unverified keyword match.

Contrast: the acoustic path (`synthesis_worker.rs`, `acoustic_signals` -> `public_events`)
already has a real trust ladder (pending -> corroborating -> confirmed) with distinct-identity
and distinct-fingerprint independence checks and a TTL expiry. H-5 brings the NLP path up to a
comparable standard.

## Goals

1. Make the classifier negation-aware and stop it from claiming high confidence.
2. Replace single-source auto-promotion with a trust ladder:
   `HEURISTIC -> CORROBORATING -> CONFIRMED`.
3. Surface HEURISTIC detections on the map, clearly labeled "Automated Detection", but keep
   them inert: no push, no Bitcoin anchor, no reputation impact, no route-generation influence.
4. Persist `origin_class` (machine/human) now and reserve the guarantee that machine-origin
   evidence can never reach a future AUTHORITATIVE tier.
5. Expire stale HEURISTIC/CORROBORATING detections so the map does not accumulate uncorroborated
   automated reports.

## Non-goals (explicitly deferred)

- No unified trust-engine migration across acoustic + NLP + community reports.
- No rename of acoustic `trust_state` values.
- No changes to community-report consensus / AUTHORITATIVE promotion. The `authoritative` tier
  value is **not** introduced in this PR.
- No ML classifier. Negation handling stays rule-based.

## Part A — Negation handling (`services/signal/nlp/classifier.py`, Python)

Keep the keyword approach, but make hits negation-aware and the confidence honest.

- `NEGATION_WINDOW = 5` (module-level constant, configurable). A keyword hit is suppressed if a
  negation cue appears within the 5 tokens preceding the matched keyword. 5 (not 3) because real
  news text separates the cue from the keyword: "There is currently no evidence of a fire",
  "Police report there is not currently any active shooting".
- Negation cues (bilingual EN/SW), e.g.: `no, not, without, ended, over, contained, cleared,
  all clear, false alarm, hakuna, hapana, si, imeisha, imezimwa`. List lives next to the keyword
  sets and is easy to extend.
- If every hit in the winning category is negated (or an explicit all-clear phrase dominates),
  return `FALSE_ALARM`.
- **Honest confidence:** cap keyword-only confidence at `CONFIDENCE_CAP = 0.6`. Keyword matching
  must never masquerade as a high-confidence classifier. (The downstream ingest gate stays at
  0.3, so genuine multi-keyword hits still pass.)

Tokenization stays simple (lowercase, split on non-word characters). This is a heuristic, not a
parser; it only needs to catch the common negation patterns.

### Tests (Python)
- "no fire, all clear at Gikomba" -> `FALSE_ALARM`.
- "hakuna moto" -> not FIRE.
- "There is currently no evidence of a fire" -> not FIRE (cue within 5 tokens).
- Existing positive cases (flood, accident, robbery, ...) still classify, confidence <= 0.6.

## Part B — Trust ladder on the NLP path (Rust gateway)

Mirror the acoustic pattern: a staging table feeds a surfaced events table, promoted by a
synthesis tick. Unlike acoustic, a single HEURISTIC signal is surfaced immediately (labeled),
because the product requirement is that automated detections are visible but untrusted.

### Shared trust contract (convergence, not a parallel system)

The NLP and acoustic synthesis workers must **converge on one trust contract**, not grow two
divergent promotion engines. This PR extracts a small shared module
(`services/gateway/src/trust/contract.rs`, name TBD in plan) that defines:
- the tier vocabulary and ordering,
- the promotion-decision interface: `decide(independence_evidence, thresholds) -> tier`, where
  `independence_evidence` is expressed as distinct **provenance clusters** + distinct channels
  (acoustic's distinct pubkeys/fingerprints map onto the same shape),
- the monotonicity rule and the machine-never-AUTHORITATIVE invariant.

The NLP worker is built **against this contract** from day one. Acoustic is **not** refactored in
H-5 (per non-goals), but the contract is written so the later migration moves acoustic onto it by
adapting its evidence into the same interface — no second set of thresholds, enums, or promotion
logic. New trust logic added during H-5 lives in the shared contract, never inline in the NLP
worker, so there is a single source of truth to converge on.

### Independence model (the crux)

Trust is derived from **distinct independent origins**, never from raw row counts:

- Every NLP signal carries `source_id` and `origin_channel`.
  - `origin_channel`: coarse channel, e.g. `rss`, `twitter`, `radio`.
  - `source_id`: within-channel identity — RSS feed domain, Twitter author handle, etc.
- Authoritative trust metrics on the surfaced event:
  - `distinct_source_count` = number of distinct **provenance clusters** (see below).
  - `distinct_channel_count` = number of distinct `origin_channel`s.
- `source_count` is **display only** and must never drive a promotion decision (guards against
  duplicate-ingestion bugs inflating trust).

**Independence evolves: `source_id` -> provenance cluster.** The authoritative metric is
*distinct provenance clusters*, not distinct `source_id`s. In H-5 a provenance cluster is
**approximated** 1:1 by `source_id` (feed domain / author handle), because that is the cheapest
honest signal available now. The code and schema are framed around "provenance cluster" so the
later trust-engine migration can replace the approximation — collapsing sources that derive from
the same upstream origin (wire reposts, syndicated feeds, mirror accounts) into a single cluster
— **without** changing the promotion thresholds or any consumer. `distinct_source_count` is
therefore the count of clusters under the current approximation, not a raw `source_id` count that
later has to be renamed.

Promotion thresholds (launch defaults, tunable):

| Tier | Requirement |
|------|-------------|
| HEURISTIC | single source above the NLP confidence gate |
| CORROBORATING | `distinct_source_count >= 2` |
| CONFIRMED | `distinct_source_count >= 3` AND `distinct_channel_count >= 2` |

The channel requirement on CONFIRMED stops one noisy channel from self-confirming (e.g. three
accounts reposting the same Reuters wire are three `source_id`s but one channel -> stays
CORROBORATING at most).

> Documented caveat: the current provenance-cluster approximation (one cluster per `source_id`,
> author-level for Twitter) is a **temporary heuristic, not a strong trust guarantee**. The
> unified trust-engine migration replaces it with real provenance clustering. This is acceptable
> for H-5 because no machine-origin event gains push/anchor/route influence below CONFIRMED, and
> CONFIRMED requires cross-channel agreement.

### Schema (new migration `infra/postgres/migrations/011_nlp_trust.sql`)

`ALTER TABLE safety_events`:
- `trust_state TEXT NOT NULL DEFAULT 'heuristic' CHECK (trust_state IN ('heuristic','corroborating','confirmed'))`
- `origin_class TEXT NOT NULL DEFAULT 'machine' CHECK (origin_class IN ('machine','human'))`
- `distinct_source_count INT NOT NULL DEFAULT 1`
- `distinct_channel_count INT NOT NULL DEFAULT 1`
- monotonicity trigger (no trust downgrades), shaped after `008_synthesis.sql`.
- Comment reserving the invariant: a future `authoritative` tier must reject `origin_class='machine'`.

New `nlp_signals` staging table (analogue of `acoustic_signals`):
- `id`, `source_type`, `source_id`, `origin_channel`, `event_type`, `severity`, `title`,
  `summary`, `lat`, `lng`, `h3_r9`, `h3_r7`, `county`, `place_name`, `confidence`,
  `received_at`, `trust_state` (`pending|corroborating|confirmed|expired`),
  `linked_event_id UUID REFERENCES safety_events(id)`.
- Indexed on `(h3_r9, event_type, received_at)` for clustering and on `trust_state, received_at`
  for expiry.

### Ingest changes

Redis event payload (`services/event_schema.json`, `sentinel_core::RedisEventPayload`, and the
Python `build_event`) gains `source_id` and `origin_channel`. The Python ingest sites
(`rss_parser.py`, `twitter_stream.py`, `worker/transcriber.py`) populate them
(RSS: feed domain + `rss`; Twitter: author handle + `twitter`; acoustic transcriber: device/job
id + `radio`).

`event_subscriber.rs` no longer inserts a "confirmed" safety_event. Instead, per incoming NLP
event it:
1. inserts a `nlp_signals` row (`pending`), computing `h3_r9`/`h3_r7` from lat/lng (reusing the
   `h3o` crate already used by acoustic);
2. upserts a `safety_events` row keyed by (h3 cell + event_type + time bucket) at
   `trust_state='heuristic'`, `origin_class='machine'`, `distinct_source_count=1`,
   `distinct_channel_count=1`, and links the signal to it.

### NLP synthesis tick (new sibling worker in the gateway)

Modeled on `synthesis_worker.rs` but for `nlp_signals`/`safety_events`. Each tick:
- Recompute `distinct_source_count` / `distinct_channel_count` per active cluster from recent
  `nlp_signals`.
- Promote the linked `safety_event` `trust_state` per the threshold table (monotonic).
- Update `source_count` (display) and `source_breakdown` JSON.
- Gate behind an env flag (`NLP_SYNTHESIS_ENABLED`, default on) so it can be disabled like
  acoustic's `SYNTHESIS_ENABLED`.

Leader-election / multi-replica duplication is a known platform issue (H-7) and out of scope
here; the worker stays idempotent (UPSERT + monotonic promotion) so duplicate runs are safe.

## Part C — TTL expiry for uncorroborated detections

Mirrors acoustic `expire_stale_signals`. Run inside the NLP synthesis tick:

| Tier | TTL (from `started_at` / last update) | Action on expiry |
|------|----------------------------------------|------------------|
| HEURISTIC | 30 min | mark `is_active=false`, `state='EXPIRED'` |
| CORROBORATING | 2 h | mark `is_active=false`, `state='EXPIRED'` |
| CONFIRMED | normal lifecycle (unchanged) | n/a |

TTLs are module constants (tunable). Expired HEURISTIC/CORROBORATING events drop off the map and
their staging signals move to `expired`. This prevents a Reuters-only warehouse-fire detection
from sitting on the map for days with no corroboration.

## Part D — Side-effect gating by trust_state

All driven by `trust_state` (and, for the future ceiling, `origin_class`):

- **Push notifications** (`event_subscriber.rs` / synthesis promotion): only when
  `trust_state='confirmed'`. HEURISTIC and CORROBORATING never push. (Today push fires for any
  HIGH/CRITICAL — that is the core H-5 leak.)
- **Bitcoin anchor / reputation:** inert for HEURISTIC and CORROBORATING. Machine-origin events
  do not feed reputation at all. Eligible (machine) only at CONFIRMED.
- **Route generation:** the events consumed for routing must be filtered to
  `trust_state='confirmed'`. No standalone escape-route engine currently consumes `safety_events`
  in the gateway; the contract is enforced at the events query/WS boundary and documented so a
  future engine inherits it.
- **Future AUTHORITATIVE tier:** not built here. `origin_class='machine'` is persisted and the
  migration reserves the invariant that machine origin can never be promoted to it.

## Part E — Frontend labeling (`apps/pwa`)

- Expose `trust_state` (and `origin_class`) through the events REST API
  (`routes/events.rs` `SafetyEvent`) and the WS payloads.
- Marker styling by trust_state:
  - HEURISTIC -> muted gray/amber marker, badge "Automated Detection".
  - CORROBORATING -> more prominent marker, still flagged automated.
  - CONFIRMED -> standard verified styling.
- Touches `EventClusterLayer`, `AlertCard`/`AlertsSheet` badge logic.

## Part F — Testing

Python (`services/signal/tests/test_classifier.py`):
- negation suppression within window, all-clear -> FALSE_ALARM, Swahili negation, confidence cap.

Rust (gateway synthesis tests, alongside existing `synthesis_worker` tests):
- single source -> heuristic.
- 2 distinct source_ids -> corroborating.
- 3 distinct source_ids across >= 2 channels -> confirmed.
- 3 source_ids but 1 channel -> stays corroborating (no self-confirm).
- duplicate same-source signals do not raise `distinct_source_count`.
- push only fires at confirmed.
- HEURISTIC past TTL is expired; CONFIRMED is not.

## Rollout / compatibility

- New columns are additive with safe defaults. Existing `safety_events` rows are backfilled in
  the migration as **legacy-confirmed**, not plain `confirmed`: `trust_state='confirmed'`,
  `origin_class='machine'`, and a provenance marker `source_breakdown` ->
  `{"provenance":"legacy_confirmed"}`. This keeps them visible/trusted (no retroactive demotion)
  while making them **distinguishable** from events that earned CONFIRMED through real
  corroboration — so analytics and the future trust engine can re-evaluate or quarantine legacy
  auto-promoted rows instead of trusting them blindly. Only events ingested after deploy enter
  the HEURISTIC ladder.
- `NLP_SYNTHESIS_ENABLED` lets the ladder be dark-launched.
- Forward-compatible with the later unified trust engine on three explicit seams: (1) the shared
  trust contract the acoustic worker converges onto, (2) the provenance-cluster abstraction that
  replaces the `source_id` approximation without touching thresholds or consumers, and (3) the
  `legacy_confirmed` provenance marker that lets the engine re-evaluate pre-H-5 rows. Plus
  `origin_class`, `distinct_*` metrics, and the reserved `authoritative` invariant.
