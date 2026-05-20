# ADR-001: Signals Are Evidence, Not Events

**Status:** Accepted  
**Date:** 2026-05-20

## Context

Acoustic detection produces a stream of raw sensor readings: threat class, confidence score, location, and model metadata from client devices. These readings are noisy, unauthenticated at the source (though transport-authenticated via NIP-98), and subject to spoofing via coordinated submission.

The naive design — write each detection to a `public_events` table and broadcast it to all map clients — is fragile: a single device or a small coordinated group can flood the map with false alerts. Suppressing this requires either pre-filtering (which delays genuine alerts) or post-moderation (which requires ongoing human effort).

The trust synthesis pipeline addresses this by separating concerns: raw sensor data is accumulated as evidence before any public-facing event is created.

## Decision

Acoustic signals are stored in `acoustic_signals` (raw evidence). A background synthesis worker transforms evidence clusters into `public_events` (confirmed observations). These are distinct tables with distinct semantics.

The pipeline is: `acoustic_signals → synthesis worker → public_events → WS broadcast → map clients`.

No code path may write directly from an acoustic ingest request to `public_events`. The synthesis worker is the only writer.

## Invariants

These are governance contracts. Violations — even in test environments — require a new ADR and architectural review before merging.

1. **No direct signal-to-event creation.** Writing to `acoustic_signals` never directly creates a `public_events` row. All public event creation goes through the synthesis worker.

2. **Trust state is monotonic.** `acoustic_signals.trust_state` transitions are one-way: `expired` is terminal; `confirmed` cannot revert to `pending` or `corroborating`. Enforced by database trigger `trg_trust_state_monotonicity`.

3. **public_events is a derived view.** Reconstructing `public_events` from `acoustic_signals` with the same synthesis version and configuration must produce the same result. The synthesis worker is deterministic.

4. **Lineage is append-only.** `public_events.lineage` array fields (`moderator_actions`, `severity_escalations`, `derived_from`) are never overwritten, only appended. No lineage data is removed.

5. **Evidence is retained, not deleted.** `acoustic_signals` rows are never deleted. Only column-level privacy degradation is permitted: `lat`/`lng` are nulled after 24 h, `h3_r9` after 7 days, `h3_r7` is retained permanently. This schedule is documented in `infra/postgres/migrations/008_synthesis.sql` via `COMMENT ON COLUMN`.

6. **No audio leaves the device.** The ingest route accepts derived signals only (threat class, confidence, waveform fingerprint). There is no audio upload endpoint and there must never be one.

## Consequences

- A confirmed public event cannot be suppressed by deleting signals — only moderator action (`trust_state = 'disputed'` on the public event) removes it from the map.
- Privacy degradation (lat/lng nulling) does not affect confirmed public events — events carry their own location data derived at confirmation time from H3 cell centroid.
- Forensic reconstruction is possible: `public_events.lineage.derived_from` links every event back to its source signals.
- Retroactive recalibration is possible: all events tagged with a given `synthesis_version` can be reprocessed against a newer algorithm.
- The synthesis worker is the single enforcement point for all scoring, threshold, and state-transition logic. Adding a new signal path (crowd reports, BLE) means adding a new ingest table, not modifying the public events write path.

## References

- Privacy schedule: `infra/postgres/migrations/008_synthesis.sql`
- State machine + trigger: `infra/postgres/migrations/008_synthesis.sql` (`enforce_trust_state_monotonicity`)
- Synthesis worker: `services/gateway/src/subscribers/synthesis_worker.rs`
- Design spec: `docs/superpowers/specs/2026-05-20-acoustic-trust-pipeline-design.md` §Signal vs Event, §Privacy Invariants
