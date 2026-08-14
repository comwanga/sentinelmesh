-- Chat notification plumbing: relay webhook receipts, per-identity notification
-- preferences, and a dedicated chat push outbox. The chat outbox is independent
-- of the safety_events-foreign-keyed push_deliveries outbox.

CREATE TABLE relay_webhook_receipts (
  delivery_id      TEXT PRIMARY KEY,
  relay_event_id   TEXT NOT NULL UNIQUE,
  recipient_pubkey TEXT NOT NULL,
  kind             INTEGER NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at     TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'rejected'))
);

CREATE TABLE chat_notification_preferences (
  nostr_pubkey    TEXT PRIMARY KEY,
  dm_enabled      BOOLEAN NOT NULL DEFAULT true,
  quiet_hours     JSONB NOT NULL DEFAULT '{}'::jsonb,
  public_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_push_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  dedupe_key      TEXT NOT NULL UNIQUE,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'dead')),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at       TIMESTAMPTZ,
  worker_id       UUID,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ
);

CREATE INDEX chat_push_claim_idx ON chat_push_deliveries (available_at, created_at) WHERE status = 'pending';
CREATE INDEX chat_push_stale_lease_idx ON chat_push_deliveries (locked_at) WHERE status = 'processing';

GRANT SELECT, INSERT, UPDATE, DELETE ON relay_webhook_receipts TO sentinel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_notification_preferences TO sentinel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_push_deliveries TO sentinel_app;
