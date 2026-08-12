-- First populated-database migration after the immutable clean V2 baseline.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON schema_versions FROM sentinel_app;
GRANT SELECT ON schema_versions TO sentinel_app;
