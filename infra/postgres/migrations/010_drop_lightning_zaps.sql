-- infra/postgres/migrations/010_drop_lightning_zaps.sql
--
-- Lightning Zaps removed from SentinelMesh (see docs/audit/lightning-removal-review.md).
-- Drops the payment table on already-deployed databases. Fresh installs never
-- create it (removed from init.sql). Idempotent.

DROP TABLE IF EXISTS lightning_zaps CASCADE;
