-- infra/postgres/migrations/008_synthesis.sql

-- 1. schema_version on acoustic_signals for protocol evolution
ALTER TABLE acoustic_signals
    ADD COLUMN IF NOT EXISTS schema_version INT NOT NULL DEFAULT 1;

-- 2. Privacy retention schedule — governance contracts (ADR-001)
COMMENT ON COLUMN acoustic_signals.lat IS
    'Exact latitude. Nulled by nightly job after 24 h (ADR-001 coordinate precision degradation).';
COMMENT ON COLUMN acoustic_signals.lng IS
    'Exact longitude. Nulled by nightly job after 24 h (ADR-001 coordinate precision degradation).';
COMMENT ON COLUMN acoustic_signals.h3_r9 IS
    'H3 resolution-9 cell (~100 m). Nulled by nightly job after 7 days (ADR-001). Used only during active corroboration window (<120 s).';
COMMENT ON COLUMN acoustic_signals.h3_r7 IS
    'H3 resolution-7 cell (~5 km). Permanent precision floor. Never nulled. Safe for aggregate analytics.';

-- 3. Trust-state monotonicity trigger
CREATE OR REPLACE FUNCTION enforce_trust_state_monotonicity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.trust_state = 'expired' THEN
        RAISE EXCEPTION
            'acoustic_signals: trust_state is terminal at expired (id=%, attempted transition to %)',
            OLD.id, NEW.trust_state;
    END IF;
    IF OLD.trust_state = 'confirmed' AND NEW.trust_state IN ('pending', 'corroborating') THEN
        RAISE EXCEPTION
            'acoustic_signals: confirmed cannot revert to % (id=%)',
            NEW.trust_state, OLD.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_trust_state_monotonicity
    BEFORE UPDATE OF trust_state ON acoustic_signals
    FOR EACH ROW
    WHEN (OLD.trust_state IS DISTINCT FROM NEW.trust_state)
    EXECUTE FUNCTION enforce_trust_state_monotonicity();

-- 4. public_events — derived projection of confirmed acoustic clusters
CREATE TABLE IF NOT EXISTS public_events (
    id              UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Stable idempotency key: UUID of the earliest-received signal in the cluster
    first_signal_id UUID             NOT NULL REFERENCES acoustic_signals(id),
    threat_class    TEXT             NOT NULL,
    h3_r9           TEXT,
    h3_r7           TEXT             NOT NULL,
    cluster_score   REAL             NOT NULL,
    trust_state     TEXT             NOT NULL DEFAULT 'corroborating'
                    CHECK (trust_state IN ('corroborating', 'confirmed', 'disputed', 'expired')),
    severity        TEXT             NOT NULL DEFAULT 'MEDIUM'
                    CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    n_contributors  INT              NOT NULL DEFAULT 0,
    trust_mass      REAL             NOT NULL DEFAULT 0.0,
    lineage         JSONB            NOT NULL DEFAULT '{
        "derived_from": [],
        "merged_from": [],
        "split_from": null,
        "synthesis_version": "synth-v1",
        "synthesis_run_id": null,
        "clustering_algo_version": "dbscan-h3-v1",
        "temporal_decay_version": "decay-v1",
        "trust_weight_version": "trust-v1",
        "antispoof_ruleset_version": "antispoof-v1",
        "sensor_independence_version": "indep-v1",
        "cluster_score_raw": 0.0,
        "cluster_score_adjusted": 0.0,
        "confidence_variance_mean": 0.0,
        "threshold_profile": "default-v1",
        "n_contributors": 0,
        "trust_mass": 0.0,
        "moderator_actions": [],
        "severity_escalations": []
    }'::jsonb,
    schema_version  INT              NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),
    confirmed_at    TIMESTAMPTZ,
    expired_at      TIMESTAMPTZ
);

-- Idempotency: one active public_event per cluster anchor signal
CREATE UNIQUE INDEX IF NOT EXISTS public_events_first_signal_uniq
    ON public_events (first_signal_id);

-- Viewport WS query index: active events by H3 r7 region
CREATE INDEX IF NOT EXISTS public_events_viewport_idx
    ON public_events (h3_r7, trust_state, updated_at DESC);

-- Synthesis worker lookup: active clusters by cell + class
CREATE INDEX IF NOT EXISTS public_events_cluster_idx
    ON public_events (h3_r9, threat_class)
    WHERE trust_state IN ('corroborating', 'confirmed');
