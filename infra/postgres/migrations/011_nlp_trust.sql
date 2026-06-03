-- infra/postgres/migrations/011_nlp_trust.sql
-- H-5: NLP trust ladder plumbing.
--   * trust_state + origin_class + independence metrics on safety_events
--   * monotonic trust-state trigger (no downgrades, unknown values rejected)
--   * legacy-confirmed backfill of pre-H-5 rows (one-time; guarded no-op on re-run)
--   * nlp_signals staging table feeding the NLP synthesis worker (Phase 2B)

-- 1. Trust columns on safety_events. Existing rows take the column defaults first
--    (trust_state='heuristic'); step 2 then promotes them to legacy-confirmed.
ALTER TABLE safety_events
    ADD COLUMN IF NOT EXISTS trust_state TEXT NOT NULL DEFAULT 'heuristic'
        CHECK (trust_state IN ('heuristic', 'corroborating', 'confirmed')),
    ADD COLUMN IF NOT EXISTS origin_class TEXT NOT NULL DEFAULT 'machine'
        CHECK (origin_class IN ('machine', 'human')),
    ADD COLUMN IF NOT EXISTS distinct_source_count INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS distinct_channel_count INT NOT NULL DEFAULT 1;
-- NOTE: safety_events lifecycle expiry uses the separate `state` column
-- ('REPORTED'/'ACTIVE'/.../'EXPIRED'); `trust_state` deliberately has no 'expired'
-- value. The nlp_signals staging table below DOES use 'expired' for its own TTL.

-- 2. Legacy-confirmed backfill. One-time promotion of rows that existed before H-5
--    (auto-promoted under the old single-source logic). Keep them visible/trusted
--    (no retroactive demotion) but tag them so analytics and the future trust
--    engine can tell them apart from genuinely corroborated CONFIRMED events.
--    Guarded so a re-run is a no-op: rows already marked are skipped and the jsonb
--    write never repeats.
UPDATE safety_events
   SET trust_state = 'confirmed',
       source_breakdown = jsonb_set(
           COALESCE(source_breakdown, '{}'::jsonb),
           '{provenance}', '"legacy_confirmed"'::jsonb, true)
 WHERE (source_breakdown ->> 'provenance') IS DISTINCT FROM 'legacy_confirmed';

-- 3. Trust-state monotonicity: heuristic(0) -> corroborating(1) -> confirmed(2),
--    never backwards. Unknown values raise rather than silently passing.
CREATE OR REPLACE FUNCTION enforce_safety_event_trust_monotonicity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    rank_old INT := CASE OLD.trust_state
        WHEN 'heuristic' THEN 0 WHEN 'corroborating' THEN 1 WHEN 'confirmed' THEN 2 ELSE NULL END;
    rank_new INT := CASE NEW.trust_state
        WHEN 'heuristic' THEN 0 WHEN 'corroborating' THEN 1 WHEN 'confirmed' THEN 2 ELSE NULL END;
BEGIN
    IF rank_old IS NULL OR rank_new IS NULL THEN
        RAISE EXCEPTION
            'safety_events: unknown trust_state in monotonicity check (old=%, new=%, id=%)',
            OLD.trust_state, NEW.trust_state, OLD.id;
    END IF;
    IF rank_new < rank_old THEN
        RAISE EXCEPTION
            'safety_events: trust_state cannot downgrade from % to % (id=%)',
            OLD.trust_state, NEW.trust_state, OLD.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_safety_event_trust_monotonicity
    BEFORE UPDATE OF trust_state ON safety_events
    FOR EACH ROW
    WHEN (OLD.trust_state IS DISTINCT FROM NEW.trust_state)
    EXECUTE FUNCTION enforce_safety_event_trust_monotonicity();

-- 4. nlp_signals staging table. One row per ingested NLP detection. The synthesis
--    worker (Phase 2B) groups these by (h3_r9, event_type) to count distinct
--    provenance clusters (source_id) and channels (origin_channel). h3_r9 is
--    NOT NULL: NLP signals always carry coordinates (lat/lng NOT NULL) so the
--    resolution-9 cell is always computable at ingest, and the partial cluster
--    index never silently drops a signal.
CREATE TABLE IF NOT EXISTS nlp_signals (
    id              UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID             REFERENCES safety_events(id) ON DELETE SET NULL,
    source_type     TEXT             NOT NULL,
    source_id       TEXT,
    origin_channel  TEXT             NOT NULL,
    event_type      TEXT             NOT NULL,
    severity        TEXT             NOT NULL,
    title           TEXT,
    summary         TEXT,
    lat             DOUBLE PRECISION NOT NULL,
    lng             DOUBLE PRECISION NOT NULL,
    h3_r9           TEXT             NOT NULL,
    h3_r7           TEXT             NOT NULL,
    county          TEXT,
    place_name      TEXT,
    confidence      REAL             NOT NULL,
    received_at     TIMESTAMPTZ      NOT NULL DEFAULT now(),
    trust_state     TEXT             NOT NULL DEFAULT 'pending'
                    CHECK (trust_state IN ('pending', 'corroborating', 'confirmed', 'expired'))
);

-- Synthesis worker lookup: active signals by cell + type within a time window.
CREATE INDEX IF NOT EXISTS nlp_signals_cluster_idx
    ON nlp_signals (h3_r9, event_type, received_at)
    WHERE trust_state IN ('pending', 'corroborating');

-- Join back to the surfaced event.
CREATE INDEX IF NOT EXISTS nlp_signals_event_idx ON nlp_signals (event_id);
