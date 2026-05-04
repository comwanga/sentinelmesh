CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS earthdistance CASCADE;
CREATE EXTENSION IF NOT EXISTS cube;

-- Safety events from public signal aggregation
CREATE TABLE safety_events (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type       VARCHAR(30)  NOT NULL CHECK (event_type IN ('TRAFFIC_INCIDENT','FLOOD','CIVIL_UNREST','SECURITY_INCIDENT','FIRE','MEDICAL_EMERGENCY','INFRASTRUCTURE_FAILURE','FALSE_ALARM')),
  severity         VARCHAR(10)  NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  title            VARCHAR(200) NOT NULL,
  summary          TEXT,

  place_name       VARCHAR(200),
  lat              DECIMAL(10,7) NOT NULL,
  lng              DECIMAL(10,7) NOT NULL,
  county           VARCHAR(50),
  radius_meters    INT DEFAULT 500,

  confidence       DECIMAL(4,3),
  source_count     INT DEFAULT 1,
  source_breakdown JSONB DEFAULT '{}',

  is_active        BOOLEAN DEFAULT true,
  started_at       TIMESTAMPTZ NOT NULL,
  resolved_at      TIMESTAMPTZ,
  last_updated     TIMESTAMPTZ DEFAULT NOW(),

  nostr_event_id   VARCHAR(64),
  bitcoin_txid     VARCHAR(64),
  bitcoin_block    INT,

  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Community reports (Phase 2)
CREATE TABLE community_reports (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_type      VARCHAR(30)  NOT NULL,
  description      TEXT,
  lat              DECIMAL(10,7) NOT NULL,
  lng              DECIMAL(10,7) NOT NULL,
  place_name       VARCHAR(200),
  nostr_pubkey     VARCHAR(64)  NOT NULL,
  nostr_signature  VARCHAR(128) NOT NULL,
  nostr_event_id   VARCHAR(64),
  reporter_tier    VARCHAR(20)  DEFAULT 'NEWCOMER',
  consensus_score  INT          DEFAULT 1,
  status           VARCHAR(20)  DEFAULT 'PENDING',
  confirmation_count INT        DEFAULT 0,
  denial_count     INT          DEFAULT 0,
  photo_ipfs_cid   VARCHAR(100),
  linked_event_id  UUID REFERENCES safety_events(id),
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW()
);

-- Report votes (Phase 2)
CREATE TABLE report_votes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id    UUID NOT NULL REFERENCES community_reports(id),
  voter_pubkey VARCHAR(64) NOT NULL,
  vote         VARCHAR(10) NOT NULL,
  voter_lat    DECIMAL(10,7),
  voter_lng    DECIMAL(10,7),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(report_id, voter_pubkey)
);

-- Users (Nostr pubkey only — no personal data)
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nostr_pubkey     VARCHAR(64) UNIQUE NOT NULL,
  reputation_score INT  DEFAULT 0,
  reputation_tier  VARCHAR(20) DEFAULT 'NEWCOMER',
  total_reports    INT  DEFAULT 0,
  accurate_reports INT  DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  last_active      TIMESTAMPTZ DEFAULT NOW()
);

-- Family circles (Phase 3)
CREATE TABLE circles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_pubkey VARCHAR(64) NOT NULL,
  name         VARCHAR(50),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE circle_members (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  circle_id      UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  member_pubkey  VARCHAR(64) NOT NULL,
  display_name   VARCHAR(30),
  alert_radius_km DECIMAL(4,1) DEFAULT 2.0,
  alert_severity VARCHAR(10)  DEFAULT 'HIGH',
  joined_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(circle_id, member_pubkey)
);

-- Encrypted location blobs — server cannot read these (Phase 3)
CREATE TABLE location_blobs (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_pubkey_hash   VARCHAR(64) NOT NULL,
  sender_ephemeral_pubkey VARCHAR(64) NOT NULL,
  encrypted_payload       TEXT NOT NULL,
  circle_id               UUID REFERENCES circles(id),
  expires_at              TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 minutes'),
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Blockchain anchors (Phase 4)
CREATE TABLE blockchain_anchors (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  anchor_type     VARCHAR(20) NOT NULL,
  period_start    TIMESTAMPTZ,
  period_end      TIMESTAMPTZ,
  event_count     INT,
  digest_hash     CHAR(64)    NOT NULL,
  digest_payload  JSONB       NOT NULL,
  bitcoin_txid    VARCHAR(64),
  bitcoin_block   INT,
  bitcoin_network VARCHAR(10) DEFAULT 'testnet',
  anchor_status   VARCHAR(20) DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at    TIMESTAMPTZ,
  UNIQUE (digest_hash)
);

-- Indexes for Phase 1 query patterns
CREATE INDEX idx_events_active    ON safety_events(is_active, severity);
CREATE INDEX idx_events_type      ON safety_events(event_type, started_at DESC);
CREATE INDEX idx_events_county    ON safety_events(county, is_active);
CREATE INDEX idx_events_location  ON safety_events USING gist (ll_to_earth(lat, lng));
CREATE INDEX idx_blobs_recipient  ON location_blobs(recipient_pubkey_hash, expires_at);
CREATE INDEX idx_events_started_at ON safety_events(started_at DESC);
CREATE INDEX idx_reports_pubkey    ON community_reports(nostr_pubkey, created_at DESC);
CREATE INDEX idx_reports_event     ON community_reports(linked_event_id) WHERE linked_event_id IS NOT NULL;
CREATE INDEX idx_blobs_expiry      ON location_blobs(expires_at);

-- Lightning zaps — reporter tips via Bitcoin Lightning (Phase 5)
CREATE TABLE lightning_zaps (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id         UUID NOT NULL REFERENCES community_reports(id) ON DELETE CASCADE,
  recipient_pubkey  VARCHAR(64)  NOT NULL,
  amount_sats       INT          NOT NULL CHECK (amount_sats > 0 AND amount_sats <= 100000),
  bolt11_invoice    TEXT         NOT NULL,
  payment_hash      VARCHAR(64)  NOT NULL UNIQUE,
  status            VARCHAR(20)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired')),
  paid_at           TIMESTAMPTZ,
  zap_receipt_id    VARCHAR(64),
  zap_receipt_json  JSONB,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '1 hour')
);

CREATE INDEX idx_zaps_report     ON lightning_zaps(report_id);
CREATE INDEX idx_zaps_recipient  ON lightning_zaps(recipient_pubkey);
CREATE INDEX idx_zaps_status     ON lightning_zaps(status, expires_at);
CREATE INDEX idx_zaps_hash       ON lightning_zaps(payment_hash);

-- Blockchain anchoring job queue and audit trail
CREATE TABLE publish_jobs (
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

CREATE INDEX idx_publish_jobs_claimable
  ON publish_jobs (next_retry_at, status)
  WHERE status IN ('PENDING', 'FAILED');

CREATE UNIQUE INDEX idx_publish_jobs_source
  ON publish_jobs (source_type, source_id)
  WHERE status != 'DEAD';

CREATE TABLE publish_failures (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id        UUID NOT NULL REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  step          VARCHAR(30) NOT NULL,
  error_message TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_publish_failures_job ON publish_failures(job_id);
