-- infra/postgres/migrations/006_zap_hardening.sql

-- 1. Extend status enum to include 'failed'
ALTER TABLE lightning_zaps
  DROP CONSTRAINT IF EXISTS lightning_zaps_status_check;

ALTER TABLE lightning_zaps
  ADD CONSTRAINT lightning_zaps_status_check
    CHECK (status IN ('pending', 'paid', 'expired', 'failed'));

-- 2. Receipt delivery tracking columns
ALTER TABLE lightning_zaps
  ADD COLUMN IF NOT EXISTS receipt_published       BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receipt_retry_count     INT         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receipt_last_attempt_at TIMESTAMPTZ;

-- 3. Partial indexes for background workers
CREATE INDEX IF NOT EXISTS idx_zaps_receipt_pending
  ON lightning_zaps (receipt_retry_count, receipt_last_attempt_at)
  WHERE status = 'paid' AND receipt_published = false;

CREATE INDEX IF NOT EXISTS idx_zaps_expiry_pending
  ON lightning_zaps (expires_at)
  WHERE status = 'pending';
