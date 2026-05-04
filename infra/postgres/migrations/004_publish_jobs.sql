CREATE TABLE IF NOT EXISTS publish_jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_type     VARCHAR(20) NOT NULL
                  CHECK (source_type IN ('SAFETY_EVENT','COMMUNITY_REPORT')),
  source_id       UUID NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','PROCESSING','NOSTR_PUBLISHED','BITCOIN_ANCHORED','COMPLETE','FAILED','DEAD')),
  worker_id       VARCHAR(64),
  locked_at       TIMESTAMPTZ,
  nostr_kind1_id  VARCHAR(64),
  nostr_kind30078_id VARCHAR(64),
  bitcoin_txid    VARCHAR(64),
  anchor_hash     CHAR(64),
  retry_count     INT NOT NULL DEFAULT 0,
  next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publish_jobs_claimable
  ON publish_jobs (next_retry_at, status)
  WHERE status IN ('PENDING', 'FAILED');

CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_jobs_source
  ON publish_jobs (source_type, source_id)
  WHERE status != 'DEAD';

CREATE TABLE IF NOT EXISTS publish_failures (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id        UUID NOT NULL REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  step          VARCHAR(30) NOT NULL,
  error_message TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publish_failures_job ON publish_failures(job_id);
