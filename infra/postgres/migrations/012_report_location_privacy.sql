-- infra/postgres/migrations/012_report_location_privacy.sql
-- C-2: community-report location privacy.
--   * report_authors: identity fields moved off the public community_reports row
--   * sentinel_reputation NOLOGIN role + grants + RLS so only a SET ROLE'd
--     connection can read author identities
--   * h3_r9 coarse cell column on community_reports (populated by the app/backfill)
--   * report_votes: voter coordinates replaced by a voter_was_nearby boolean
-- NOTE: existing community_reports rows keep their (still precise) lat/lng until
-- the gateway one-shot backfill snaps them; h3_r9 is therefore nullable here.

-- 1. Coarse cell column (nullable: legacy rows are backfilled by the gateway,
--    new rows always set it in create_report).
ALTER TABLE community_reports ADD COLUMN IF NOT EXISTS h3_r9 TEXT; -- (gateway backfill in plan Task 3 fills legacy rows; new rows set it in create_report)

-- 2. Identity table. One row per report; holds every identity-linked field.
CREATE TABLE IF NOT EXISTS report_authors (
    report_id       UUID PRIMARY KEY REFERENCES community_reports(id) ON DELETE CASCADE,
    nostr_pubkey    TEXT NOT NULL,
    -- nullable here (TEXT): the source community_reports column was NOT NULL, but
    -- some Nostr events omit a signature; report_authors does not re-impose it.
    nostr_signature TEXT,
    nostr_event_id  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Backfill identity rows from existing community_reports, then drop the
--    identity columns + the pubkey index from the public table.
INSERT INTO report_authors (report_id, nostr_pubkey, nostr_signature, nostr_event_id)
SELECT id, nostr_pubkey, nostr_signature, nostr_event_id
  FROM community_reports
ON CONFLICT (report_id) DO NOTHING;

DROP INDEX IF EXISTS idx_reports_pubkey;
ALTER TABLE community_reports
    DROP COLUMN IF EXISTS nostr_pubkey,
    DROP COLUMN IF EXISTS nostr_signature,
    DROP COLUMN IF EXISTS nostr_event_id;

-- 4. Voter coordinates -> boolean.
ALTER TABLE report_votes ADD COLUMN IF NOT EXISTS voter_was_nearby BOOLEAN;
ALTER TABLE report_votes
    DROP COLUMN IF EXISTS voter_lat,
    DROP COLUMN IF EXISTS voter_lng;

-- 5. Restricted role + access control on report_authors.
--    NOLOGIN: a privilege bucket reached via SET ROLE, not a login identity.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentinel_reputation') THEN
        CREATE ROLE sentinel_reputation NOLOGIN;
    END IF;
END$$;

REVOKE SELECT ON report_authors FROM PUBLIC;
REVOKE SELECT ON report_authors FROM sentinel;
GRANT  INSERT ON report_authors TO sentinel;          -- app role: write-only
GRANT  SELECT ON report_authors TO sentinel_reputation;
-- Member of the restricted role so the app role can SET ROLE to it, but WITHOUT
-- inheriting its privileges (PG16 scoped non-inheritance — avoids a global
-- ALTER ROLE ... NOINHERIT footgun). The app role must SET ROLE explicitly to
-- gain SELECT on report_authors.
GRANT sentinel_reputation TO sentinel WITH INHERIT FALSE;

ALTER TABLE report_authors ENABLE ROW LEVEL SECURITY;
-- FORCE so the table OWNER (the migration runner / app role) is ALSO subject to
-- RLS. Owners otherwise bypass policies, which would let a non-superuser
-- production app role that owns this table SELECT it without SET ROLE — defeating
-- the read restriction. (A superuser still bypasses; the dev `sentinel` is a
-- superuser, so the control is proven by the non-superuser probe test instead.)
ALTER TABLE report_authors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS report_authors_select ON report_authors;
CREATE POLICY report_authors_select ON report_authors
    FOR SELECT TO sentinel_reputation USING (true);
DROP POLICY IF EXISTS report_authors_insert ON report_authors;
CREATE POLICY report_authors_insert ON report_authors
    FOR INSERT TO sentinel WITH CHECK (true);
