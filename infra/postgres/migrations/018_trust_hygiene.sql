-- infra/postgres/migrations/018_trust_hygiene.sql
-- C-1b-1: trust hygiene. Reputation decay (earned vs effective + last_verified_at
-- decay clock + rejected_reports), advisory voucher-accountability operator fields,
-- and a periodic aggregate-metrics snapshot table powering the Trust Observatory.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS effective_reputation_score INT,
    ADD COLUMN IF NOT EXISTS last_verified_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_reports           INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS vouching_suspended         BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS vouch_budget_override      INT;

-- Existing users start un-decayed: effective = earned.
UPDATE users SET effective_reputation_score = reputation_score
 WHERE effective_reputation_score IS NULL;

-- Aggregate-only operational metrics (no identity linkage), one row per worker tick.
CREATE TABLE IF NOT EXISTS trust_metrics_snapshots (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    metrics     JSONB       NOT NULL
);
CREATE INDEX IF NOT EXISTS trust_metrics_snapshots_captured_idx
    ON trust_metrics_snapshots (captured_at);
