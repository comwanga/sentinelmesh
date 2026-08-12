#!/bin/sh
set -eu

: "${POSTGRES_ADMIN_PASSWORD:?POSTGRES_ADMIN_PASSWORD is required}"
: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_DB:=sentinelmesh}"
: "${POSTGRES_USER:=postgres}"
: "${MIGRATIONS_DIR:=/migrations-v2}"

export PGPASSWORD="$POSTGRES_ADMIN_PASSWORD"

psql_base="psql --host=$POSTGRES_HOST --username=$POSTGRES_USER --dbname=$POSTGRES_DB --set=ON_ERROR_STOP=1 --no-psqlrc"

attempt=0
until $psql_base --command='SELECT 1' >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "database did not become ready for migrations" >&2
    exit 1
  fi
  sleep 2
done

{
  echo 'SELECT pg_advisory_lock(734628491);'
  cat <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  version      INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  checksum     TEXT NOT NULL,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON schema_migrations FROM PUBLIC, sentinel_app;
GRANT SELECT ON schema_migrations TO sentinel_app;
SQL
  for migration in "$MIGRATIONS_DIR"/*.sql; do
    [ -f "$migration" ] || continue
    filename=$(basename "$migration")
    version=${filename%%_*}
    checksum=$(sha256sum "$migration" | cut -d ' ' -f 1)
    cat <<SQL
DO \$\$
DECLARE existing_checksum TEXT; existing_name TEXT;
BEGIN
  SELECT checksum, name INTO existing_checksum, existing_name
  FROM schema_migrations WHERE version = $version;
  IF existing_checksum IS NOT NULL AND existing_checksum <> '$checksum' THEN
    RAISE EXCEPTION 'checksum mismatch for migration $filename';
  END IF;
  IF existing_name IS NOT NULL AND existing_name <> '$filename' THEN
    RAISE EXCEPTION 'name mismatch for migration $filename';
  END IF;
END \$\$;
SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $version) AS migration_applied \gset
\if :migration_applied
  \echo migration $filename already applied
\else
BEGIN;
\i $migration
INSERT INTO schema_migrations (version, name, checksum)
VALUES ($version, '$filename', '$checksum');
INSERT INTO schema_versions (version, description)
VALUES ($version, '$filename');
COMMIT;
\endif
SQL
  done
  cat <<'SQL'
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON schema_versions FROM sentinel_app;
GRANT SELECT ON schema_versions TO sentinel_app;
SQL
  echo 'SELECT pg_advisory_unlock(734628491);'
} | $psql_base

file_count=$(set -- "$MIGRATIONS_DIR"/*.sql; [ -f "$1" ] && echo "$#" || echo 0)
applied_count=$($psql_base --tuples-only --no-align --command='SELECT count(*) FROM schema_migrations')
if [ "$applied_count" -ne "$file_count" ]; then
  echo "migration history contains missing or unknown files" >&2
  exit 1
fi

echo "database migrations are current"
