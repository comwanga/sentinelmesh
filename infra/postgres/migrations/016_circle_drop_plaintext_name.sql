-- infra/postgres/migrations/016_circle_drop_plaintext_name.sql
-- C-3 Phase B: drop the legacy plaintext circle name.
-- DEPLOY ORDERING (existing data): apply only after the client lazy migration has
-- converged (owners online at least once, name_version flipped to 1). Circles
-- still at name_version=0 lose their plaintext name and show "(unnamed)" until the
-- owner renames. On a fresh/empty DB this is a no-op-safe immediate drop. Idempotent.

ALTER TABLE circles DROP COLUMN IF EXISTS name;
