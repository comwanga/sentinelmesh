-- infra/postgres/migrations/017_vouches.sql
-- C-1a: web-of-trust vouching. Append-only attestation graph backing the
-- personhood signal that gates report-consensus escalation. Rows are NEVER
-- physically deleted: revocation sets revoked_at, preserving a full audit trail
-- for C-1b detection. vouches is PUBLIC data (the voucher opts in to disclosing
-- the single edge), so no RLS / restricted role — unlike report_authors.

CREATE TABLE IF NOT EXISTS vouches (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_pubkey  TEXT         NOT NULL,
    vouchee_pubkey  TEXT         NOT NULL,
    -- Voucher's basis AT ISSUANCE ('EARNED' == the reputation-based path).
    -- Informational/audit only; active-vouch validity re-checks CURRENT
    -- eligibility (see personhood resolver), never this stored value.
    issuance_basis  TEXT         NOT NULL CHECK (issuance_basis IN ('ROOT', 'EARNED')),
    nostr_event_id  TEXT         NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ,                 -- soft delete; NULL = active
    expires_at      TIMESTAMPTZ,                 -- DORMANT seam (always NULL in C-1a)
    CHECK (voucher_pubkey <> vouchee_pubkey)
);

-- At most ONE active edge per (voucher, vouchee); unlimited historical (revoked) rows.
CREATE UNIQUE INDEX IF NOT EXISTS vouches_active_unique
    ON vouches (voucher_pubkey, vouchee_pubkey) WHERE revoked_at IS NULL;

-- Personhood lookup: active vouches for a given vouchee.
CREATE INDEX IF NOT EXISTS vouches_vouchee_active_idx
    ON vouches (vouchee_pubkey) WHERE revoked_at IS NULL;

-- Budget lookup: active vouches held by a given voucher.
CREATE INDEX IF NOT EXISTS vouches_voucher_active_idx
    ON vouches (voucher_pubkey) WHERE revoked_at IS NULL;
