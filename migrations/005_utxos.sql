-- bitcoin_block for community reports (safety_events already has this column)
ALTER TABLE community_reports ADD COLUMN IF NOT EXISTS bitcoin_block INT;

-- UTXO pool for per-event blockchain anchoring
CREATE TABLE utxos (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  txid             VARCHAR(64) NOT NULL,
  vout             INT NOT NULL,
  value_sats       BIGINT NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED'
                   CHECK (status IN ('CONFIRMED', 'LOCKED', 'UNCONFIRMED', 'SPENT')),
  spending_job_id  UUID REFERENCES publish_jobs(id),
  creating_job_id  UUID REFERENCES publish_jobs(id),
  locked_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (txid, vout)
);

CREATE INDEX idx_utxos_claimable   ON utxos (status) WHERE status = 'CONFIRMED';
CREATE INDEX idx_utxos_locked      ON utxos (status, locked_at) WHERE status = 'LOCKED';
CREATE INDEX idx_utxos_unconfirmed ON utxos (status, txid) WHERE status = 'UNCONFIRMED';
