\set ON_ERROR_STOP on

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

CREATE TABLE schema_versions (
  version       INTEGER PRIMARY KEY,
  description   TEXT NOT NULL,
  installed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE safety_events (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type             TEXT NOT NULL CHECK (event_type IN ('TRAFFIC_INCIDENT','FLOOD','CIVIL_UNREST','SECURITY_INCIDENT','FIRE','MEDICAL_EMERGENCY','INFRASTRUCTURE_FAILURE','FALSE_ALARM')),
  severity               TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  title                  TEXT NOT NULL,
  summary                TEXT,
  place_name             TEXT,
  lat                    DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng                    DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  geog                   geography(Point, 4326),
  county                 TEXT,
  radius_meters          INTEGER DEFAULT 500 CHECK (radius_meters IS NULL OR radius_meters > 0),
  confidence             DOUBLE PRECISION CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  source_count           INTEGER DEFAULT 1 CHECK (source_count IS NULL OR source_count >= 0),
  source_breakdown       JSONB NOT NULL DEFAULT '{}'::jsonb,
  distinct_source_count  INTEGER NOT NULL DEFAULT 1 CHECK (distinct_source_count >= 0),
  distinct_channel_count INTEGER NOT NULL DEFAULT 1 CHECK (distinct_channel_count >= 0),
  trust_state            TEXT NOT NULL DEFAULT 'heuristic' CHECK (trust_state IN ('heuristic','corroborating','confirmed')),
  origin_class           TEXT NOT NULL DEFAULT 'machine' CHECK (origin_class IN ('machine','human')),
  is_active              BOOLEAN NOT NULL DEFAULT true,
  state                  TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('REPORTED','ACTIVE','UPDATED','RESOLVED','EXPIRED')),
  started_at             TIMESTAMPTZ NOT NULL,
  resolved_at            TIMESTAMPTZ,
  nostr_event_id         TEXT,
  bitcoin_txid           TEXT,
  bitcoin_block          INTEGER,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION sync_safety_event_geog()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.geog := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER safety_events_sync_geog
  BEFORE INSERT OR UPDATE OF lat, lng ON safety_events
  FOR EACH ROW EXECUTE FUNCTION sync_safety_event_geog();

CREATE FUNCTION enforce_safety_event_trust_monotonicity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_rank INTEGER := CASE OLD.trust_state WHEN 'heuristic' THEN 0 WHEN 'corroborating' THEN 1 WHEN 'confirmed' THEN 2 END;
  new_rank INTEGER := CASE NEW.trust_state WHEN 'heuristic' THEN 0 WHEN 'corroborating' THEN 1 WHEN 'confirmed' THEN 2 END;
BEGIN
  IF old_rank IS NULL OR new_rank IS NULL OR new_rank < old_rank THEN
    RAISE EXCEPTION 'safety_events: invalid trust transition from % to % (id=%)', OLD.trust_state, NEW.trust_state, OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER safety_events_trust_monotonicity
  BEFORE UPDATE OF trust_state ON safety_events
  FOR EACH ROW WHEN (OLD.trust_state IS DISTINCT FROM NEW.trust_state)
  EXECUTE FUNCTION enforce_safety_event_trust_monotonicity();

CREATE TABLE community_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type         TEXT NOT NULL,
  description         TEXT,
  lat                 DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng                 DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  h3_r9               TEXT NOT NULL,
  place_name          TEXT,
  reporter_tier       TEXT NOT NULL DEFAULT 'NEWCOMER',
  consensus_score     INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','UNVERIFIED','VERIFIED','AUTHORITATIVE','DISPUTED','REJECTED')),
  confirmation_count  INTEGER NOT NULL DEFAULT 0 CHECK (confirmation_count >= 0),
  denial_count        INTEGER NOT NULL DEFAULT 0 CHECK (denial_count >= 0),
  photo_ipfs_cid      TEXT,
  linked_event_id     UUID REFERENCES safety_events(id) ON DELETE SET NULL,
  bitcoin_block       INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE report_authors (
  report_id       UUID PRIMARY KEY REFERENCES community_reports(id) ON DELETE CASCADE,
  nostr_pubkey    TEXT NOT NULL,
  nostr_signature TEXT,
  nostr_event_id  TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE report_votes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         UUID NOT NULL REFERENCES community_reports(id) ON DELETE CASCADE,
  voter_pubkey      TEXT NOT NULL,
  nostr_event_id    TEXT NOT NULL UNIQUE,
  vote              TEXT NOT NULL CHECK (vote IN ('CONFIRM','DENY')),
  voter_was_nearby  BOOLEAN,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (report_id, voter_pubkey)
);

CREATE TABLE users (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nostr_pubkey                 TEXT UNIQUE NOT NULL,
  reputation_score             INTEGER NOT NULL DEFAULT 0,
  effective_reputation_score   INTEGER NOT NULL DEFAULT 0,
  reputation_tier              TEXT NOT NULL DEFAULT 'NEWCOMER',
  total_reports                INTEGER NOT NULL DEFAULT 0,
  accurate_reports             INTEGER NOT NULL DEFAULT 0,
  rejected_reports             INTEGER NOT NULL DEFAULT 0,
  last_verified_at             TIMESTAMPTZ,
  vouching_suspended           BOOLEAN NOT NULL DEFAULT false,
  vouch_budget_override        INTEGER,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE circles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_token      TEXT NOT NULL,
  name_ciphertext  TEXT,
  name_version     SMALLINT NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE circle_members (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id                UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  member_token             TEXT NOT NULL,
  member_label_ciphertext  TEXT,
  alert_radius_km          DOUBLE PRECISION DEFAULT 2.0,
  alert_severity           TEXT DEFAULT 'HIGH',
  joined_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (circle_id, member_token)
);

CREATE TABLE location_blobs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id                UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  recipient_token          TEXT NOT NULL,
  sender_ephemeral_pubkey  TEXT NOT NULL,
  encrypted_payload        TEXT NOT NULL,
  expires_at               TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nostr_pubkey  TEXT NOT NULL,
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE acoustic_signals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID NOT NULL UNIQUE,
  pubkey               TEXT NOT NULL,
  threat_class         TEXT NOT NULL,
  confidence           REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  confidence_variance  REAL,
  lat                  DOUBLE PRECISION,
  lng                  DOUBLE PRECISION,
  h3_r9                TEXT,
  h3_r7                TEXT NOT NULL,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  model_version        TEXT NOT NULL,
  threshold_profile    TEXT NOT NULL,
  inference_backend    TEXT NOT NULL,
  processing_latency   INTEGER,
  dropped_frames       INTEGER NOT NULL DEFAULT 0,
  device_category      TEXT,
  signal_fingerprint   TEXT,
  trust_state          TEXT NOT NULL DEFAULT 'pending' CHECK (trust_state IN ('pending','corroborating','confirmed','disputed','expired')),
  schema_version       INTEGER NOT NULL DEFAULT 1
);

CREATE FUNCTION enforce_acoustic_trust_monotonicity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.trust_state = 'expired' OR (OLD.trust_state = 'confirmed' AND NEW.trust_state IN ('pending','corroborating')) THEN
    RAISE EXCEPTION 'acoustic_signals: invalid trust transition from % to % (id=%)', OLD.trust_state, NEW.trust_state, OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER acoustic_signals_trust_monotonicity
  BEFORE UPDATE OF trust_state ON acoustic_signals
  FOR EACH ROW WHEN (OLD.trust_state IS DISTINCT FROM NEW.trust_state)
  EXECUTE FUNCTION enforce_acoustic_trust_monotonicity();

CREATE TABLE public_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_signal_id UUID NOT NULL UNIQUE REFERENCES acoustic_signals(id),
  threat_class    TEXT NOT NULL,
  h3_r9           TEXT,
  h3_r7           TEXT NOT NULL,
  cluster_score   REAL NOT NULL,
  trust_state     TEXT NOT NULL DEFAULT 'corroborating' CHECK (trust_state IN ('corroborating','confirmed','disputed','expired')),
  severity        TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  n_contributors  INTEGER NOT NULL DEFAULT 0,
  trust_mass      REAL NOT NULL DEFAULT 0,
  lineage         JSONB NOT NULL DEFAULT '{}'::jsonb,
  schema_version  INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ,
  expired_at      TIMESTAMPTZ
);

CREATE TABLE nlp_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID REFERENCES safety_events(id) ON DELETE SET NULL,
  source_type     TEXT NOT NULL,
  source_id       TEXT,
  origin_channel  TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  severity        TEXT NOT NULL,
  title           TEXT,
  summary         TEXT,
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  h3_r9           TEXT NOT NULL,
  h3_r7           TEXT NOT NULL,
  county          TEXT,
  place_name      TEXT,
  confidence      REAL NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  trust_state     TEXT NOT NULL DEFAULT 'pending' CHECK (trust_state IN ('pending','corroborating','confirmed','expired'))
);

CREATE TABLE publish_jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type           TEXT NOT NULL CHECK (source_type IN ('SAFETY_EVENT','COMMUNITY_REPORT')),
  source_id             UUID NOT NULL,
  status                TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','NOSTR_PUBLISHED','BITCOIN_ANCHORED','COMPLETE','FAILED','DEAD')),
  worker_id             TEXT,
  locked_at             TIMESTAMPTZ,
  nostr_kind1_id        TEXT,
  nostr_kind30078_id    TEXT,
  bitcoin_txid          TEXT,
  anchor_hash           CHAR(64),
  retry_count           INTEGER NOT NULL DEFAULT 0,
  next_retry_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE publish_failures (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         UUID NOT NULL REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  step           TEXT NOT NULL,
  error_message  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE utxos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txid             TEXT NOT NULL,
  vout             INTEGER NOT NULL,
  value_sats       BIGINT NOT NULL CHECK (value_sats > 0),
  status           TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','LOCKED','UNCONFIRMED','SPENT')),
  spending_job_id  UUID REFERENCES publish_jobs(id),
  creating_job_id  UUID REFERENCES publish_jobs(id),
  locked_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (txid, vout)
);

CREATE TABLE vouches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_pubkey   TEXT NOT NULL,
  vouchee_pubkey   TEXT NOT NULL,
  issuance_basis   TEXT NOT NULL CHECK (issuance_basis IN ('ROOT','EARNED')),
  nostr_event_id   TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  CHECK (voucher_pubkey <> vouchee_pubkey)
);

CREATE TABLE trust_metrics_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  metrics      JSONB NOT NULL
);

CREATE INDEX safety_events_active_idx ON safety_events (is_active, severity);
CREATE INDEX safety_events_type_idx ON safety_events (event_type, started_at DESC);
CREATE INDEX safety_events_county_idx ON safety_events (county, is_active);
CREATE INDEX safety_events_geog_idx ON safety_events USING gist (geog);
CREATE INDEX safety_events_state_idx ON safety_events (state);
CREATE INDEX safety_events_started_idx ON safety_events (started_at DESC);
CREATE INDEX community_reports_event_idx ON community_reports (linked_event_id) WHERE linked_event_id IS NOT NULL;
CREATE INDEX community_reports_location_idx ON community_reports USING gist (ll_to_earth(lat, lng));
CREATE INDEX location_blobs_recipient_idx ON location_blobs (circle_id, recipient_token, expires_at);
CREATE INDEX location_blobs_expiry_idx ON location_blobs (expires_at);
CREATE INDEX push_subscriptions_pubkey_idx ON push_subscriptions (nostr_pubkey);
CREATE INDEX acoustic_signals_synthesis_idx ON acoustic_signals (h3_r9, threat_class, received_at) WHERE trust_state IN ('pending','corroborating');
CREATE INDEX acoustic_signals_pubkey_idx ON acoustic_signals (pubkey, received_at DESC);
CREATE INDEX public_events_viewport_idx ON public_events (h3_r7, trust_state, updated_at DESC);
CREATE INDEX public_events_cluster_idx ON public_events (h3_r9, threat_class) WHERE trust_state IN ('corroborating','confirmed');
CREATE INDEX nlp_signals_cluster_idx ON nlp_signals (h3_r9, event_type, received_at) WHERE trust_state IN ('pending','corroborating');
CREATE INDEX nlp_signals_event_idx ON nlp_signals (event_id);
CREATE INDEX publish_jobs_claimable_idx ON publish_jobs (next_retry_at, status) WHERE status IN ('PENDING','FAILED');
CREATE UNIQUE INDEX publish_jobs_source_idx ON publish_jobs (source_type, source_id) WHERE status <> 'DEAD';
CREATE INDEX publish_failures_job_idx ON publish_failures (job_id);
CREATE INDEX utxos_claimable_idx ON utxos (status) WHERE status = 'CONFIRMED';
CREATE INDEX utxos_locked_idx ON utxos (status, locked_at) WHERE status = 'LOCKED';
CREATE INDEX utxos_unconfirmed_idx ON utxos (status, txid) WHERE status = 'UNCONFIRMED';
CREATE UNIQUE INDEX vouches_active_unique_idx ON vouches (voucher_pubkey, vouchee_pubkey) WHERE revoked_at IS NULL;
CREATE INDEX vouches_vouchee_active_idx ON vouches (vouchee_pubkey) WHERE revoked_at IS NULL;
CREATE INDEX vouches_voucher_active_idx ON vouches (voucher_pubkey) WHERE revoked_at IS NULL;
CREATE INDEX trust_metrics_captured_idx ON trust_metrics_snapshots (captured_at);

GRANT USAGE ON SCHEMA public TO sentinel_app, sentinel_reputation;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sentinel_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sentinel_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO sentinel_app;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON schema_versions FROM sentinel_app;
GRANT SELECT ON schema_versions TO sentinel_app;

REVOKE ALL ON report_authors FROM PUBLIC;
REVOKE SELECT, UPDATE, DELETE ON report_authors FROM sentinel_app;
GRANT INSERT ON report_authors TO sentinel_app;
GRANT SELECT ON report_authors TO sentinel_reputation;

ALTER TABLE report_authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_authors FORCE ROW LEVEL SECURITY;
CREATE POLICY report_authors_insert ON report_authors
  FOR INSERT TO sentinel_app WITH CHECK (true);
CREATE POLICY report_authors_select ON report_authors
  FOR SELECT TO sentinel_reputation USING (true);

INSERT INTO schema_versions (version, description)
VALUES (2, 'SentinelMesh clean V2 baseline');

COMMIT;
