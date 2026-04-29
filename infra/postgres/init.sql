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
