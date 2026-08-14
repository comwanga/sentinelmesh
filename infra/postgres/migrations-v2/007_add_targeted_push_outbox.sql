ALTER TABLE push_subscriptions
  ADD COLUMN min_severity TEXT,
  ADD COLUMN center_lat DOUBLE PRECISION,
  ADD COLUMN center_lng DOUBLE PRECISION,
  ADD COLUMN radius_km DOUBLE PRECISION,
  ADD COLUMN center_geog geography(Point, 4326),
  ADD CONSTRAINT push_subscriptions_preferences_complete CHECK (
    (min_severity IS NULL AND center_lat IS NULL AND center_lng IS NULL AND radius_km IS NULL AND center_geog IS NULL)
    OR
    (min_severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
      AND center_lat BETWEEN -90 AND 90
      AND center_lng BETWEEN -180 AND 180
      AND radius_km BETWEEN 1 AND 100
      AND center_geog IS NOT NULL)
  );

CREATE INDEX push_subscriptions_target_idx
  ON push_subscriptions (min_severity)
  WHERE center_geog IS NOT NULL;

CREATE TABLE push_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES safety_events(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  worker_id UUID,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  UNIQUE (event_id, subscription_id)
);

CREATE INDEX push_deliveries_claim_idx
  ON push_deliveries (available_at, created_at)
  WHERE status = 'pending';

CREATE INDEX push_deliveries_stale_lease_idx
  ON push_deliveries (locked_at)
  WHERE status = 'processing';
