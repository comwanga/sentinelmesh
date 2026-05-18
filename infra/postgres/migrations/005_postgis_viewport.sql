CREATE EXTENSION IF NOT EXISTS postgis;

-- State lifecycle column (nullable first so backfill can run before NOT NULL)
ALTER TABLE safety_events
  ADD COLUMN IF NOT EXISTS state VARCHAR(20)
    CHECK (state IN ('REPORTED', 'ACTIVE', 'UPDATED', 'RESOLVED', 'EXPIRED'));

UPDATE safety_events
   SET state = CASE
         WHEN is_active IS TRUE  THEN 'ACTIVE'
         WHEN is_active IS FALSE THEN 'RESOLVED'
         ELSE 'ACTIVE'
       END
 WHERE state IS NULL;

ALTER TABLE safety_events
  ALTER COLUMN state SET DEFAULT 'ACTIVE',
  ALTER COLUMN state SET NOT NULL;

-- Geography column for PostGIS spatial indexing (nullable; trigger fills it)
ALTER TABLE safety_events
  ADD COLUMN IF NOT EXISTS geog geography(Point, 4326);

UPDATE safety_events
   SET geog = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
 WHERE geog IS NULL;

-- Trigger: keep geog in sync whenever lat or lng changes
CREATE OR REPLACE FUNCTION trg_fn_sync_safety_event_geog()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.geog := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_safety_events_sync_geog ON safety_events;
CREATE TRIGGER trg_safety_events_sync_geog
  BEFORE INSERT OR UPDATE OF lat, lng ON safety_events
  FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_safety_event_geog();

-- GIST spatial index
CREATE INDEX IF NOT EXISTS idx_safety_events_geog
  ON safety_events USING GIST (geog);

-- B-tree index on state for fast active-event filtering
CREATE INDEX IF NOT EXISTS idx_safety_events_state
  ON safety_events (state);
