-- infra/postgres/migrations/014_circle_drop_plaintext.sql
-- C-3 Phase A: drop the plaintext social-graph columns once tokens are backfilled.
-- DEPLOY ORDERING (existing data): the gateway token backfill (startup) must have
-- run against migration 013 to populate owner_token/member_token BEFORE this drops
-- the source pubkey columns. On a fresh/empty DB there are no legacy rows, so 013
-- and 014 can be applied back-to-back. circles.name is intentionally KEPT
-- (encrypted in Phase B, dropped in 016). Idempotent.

DROP INDEX IF EXISTS idx_blobs_recipient; -- old recipient_pubkey_hash index from init.sql

ALTER TABLE circles        DROP COLUMN IF EXISTS owner_pubkey;
ALTER TABLE circle_members DROP COLUMN IF EXISTS member_pubkey;       -- drops UNIQUE(circle_id, member_pubkey)
ALTER TABLE location_blobs DROP COLUMN IF EXISTS recipient_pubkey_hash;
