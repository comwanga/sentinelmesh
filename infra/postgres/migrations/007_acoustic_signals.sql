-- infra/postgres/migrations/007_acoustic_signals.sql

CREATE TABLE IF NOT EXISTS acoustic_signals (
    id                   UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id            UUID             NOT NULL,
    pubkey               TEXT             NOT NULL,
    threat_class         TEXT             NOT NULL,
    confidence           REAL             NOT NULL,
    confidence_variance  REAL,
    lat                  DOUBLE PRECISION,
    lng                  DOUBLE PRECISION,
    h3_r9                TEXT,
    h3_r7                TEXT             NOT NULL,
    received_at          TIMESTAMPTZ      NOT NULL DEFAULT now(),

    model_version        TEXT             NOT NULL,
    threshold_profile    TEXT             NOT NULL,
    inference_backend    TEXT             NOT NULL,
    processing_latency   INT,
    dropped_frames       INT              NOT NULL DEFAULT 0,
    device_category      TEXT,
    signal_fingerprint   TEXT,

    trust_state          TEXT             NOT NULL DEFAULT 'pending'
                         CHECK (trust_state IN ('pending', 'corroborating', 'confirmed', 'disputed', 'expired'))
);

-- Deduplication: one row per client_id forever (UUIDs never collide in practice)
CREATE UNIQUE INDEX IF NOT EXISTS acoustic_signals_client_id_uniq
    ON acoustic_signals (client_id);

-- Synthesis worker: find active signals by cell + class within a time window
CREATE INDEX IF NOT EXISTS acoustic_signals_synthesis_idx
    ON acoustic_signals (h3_r9, threat_class, received_at)
    WHERE trust_state IN ('pending', 'corroborating');

-- Reputation worker: signals by pubkey
CREATE INDEX IF NOT EXISTS acoustic_signals_pubkey_idx
    ON acoustic_signals (pubkey, received_at DESC);
