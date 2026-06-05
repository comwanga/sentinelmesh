-- infra/postgres/migrations/013_circle_tokenization.sql
-- C-3 Phase A: add per-circle keyed token columns (owner/member/recipient).
-- Additive: plaintext pubkey columns stay until the gateway backfills tokens;
-- migration 014 drops them. display_name is dropped now (vestigial: never
-- written, never read).

ALTER TABLE circles        ADD COLUMN IF NOT EXISTS owner_token     TEXT;
ALTER TABLE circle_members ADD COLUMN IF NOT EXISTS member_token    TEXT;
ALTER TABLE location_blobs ADD COLUMN IF NOT EXISTS recipient_token TEXT;

ALTER TABLE circle_members DROP COLUMN IF EXISTS display_name;

-- New uniqueness/lookup by token. member_token is nullable until backfill; NULLs
-- are distinct in a unique index, so legacy un-backfilled rows do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS circle_members_circle_token_uniq
    ON circle_members (circle_id, member_token);
CREATE INDEX IF NOT EXISTS location_blobs_recipient_token_idx
    ON location_blobs (circle_id, recipient_token, expires_at);
