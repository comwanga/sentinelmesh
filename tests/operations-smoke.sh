#!/bin/sh
set -eu

project="sentinelmesh-operations-test-$$"
export COMPOSE_PROJECT_NAME="$project"
export POSTGRES_IMAGE="$project-postgres"
export POSTGRES_ADMIN_PASSWORD=${POSTGRES_ADMIN_PASSWORD:-operations-test-admin-password-123}
export APP_DATABASE_PASSWORD=${APP_DATABASE_PASSWORD:-operations-test-runtime-password-123}
export REDIS_PASSWORD=${REDIS_PASSWORD:-operations-test-redis-password-123}
export INTERNAL_SERVICE_SECRET=${INTERNAL_SERVICE_SECRET:-operations-test-internal-secret-123}
export CIRCLE_TOKEN_SECRET=${CIRCLE_TOKEN_SECRET:-operations-test-circle-secret-123}
compose() { ./ops/compose.sh "$@"; }
cleanup() { compose down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

compose down -v --remove-orphans
compose up -d postgres --wait
attempt=0
until [ "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT to_regclass('public.safety_events') IS NOT NULL" 2>/dev/null || true)" = t ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "V2 baseline did not finish initializing" >&2
    exit 1
  fi
  sleep 1
done
compose exec -T postgres psql -U postgres -d sentinelmesh -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO safety_events
  (id, event_type, severity, title, lat, lng, started_at, nostr_event_id)
VALUES
  ('00000000-0000-0000-0000-000000000041', 'FLOOD', 'HIGH', 'Migration preservation event', 0, 0, now(), repeat('a', 64));
INSERT INTO community_reports
  (id, report_type, description, lat, lng, h3_r9)
VALUES
  ('00000000-0000-0000-0000-000000000042', 'FLOOD', 'Migration preservation report', 0, 0, '89754e64993ffff');
INSERT INTO report_authors (report_id, nostr_pubkey, nostr_signature, nostr_event_id)
VALUES
  ('00000000-0000-0000-0000-000000000042', repeat('b', 64), repeat('c', 128), repeat('d', 64));
SQL
compose run --rm migrate >/tmp/sentinelmesh-migrate-a-$$ 2>&1 & migrate_a=$!
compose run --rm migrate >/tmp/sentinelmesh-migrate-b-$$ 2>&1 & migrate_b=$!
wait "$migrate_a"
wait "$migrate_b"
rm -f /tmp/sentinelmesh-migrate-a-$$ /tmp/sentinelmesh-migrate-b-$$
compose run --rm migrate

version=$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  'SELECT MAX(version) FROM schema_versions')
test "$version" = "4"
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT string_agg(version || '|' || name || '|' || checksum, E'\\n' ORDER BY version) FROM schema_migrations")" = "3|003_protect_migration_history.sql|d7c41d110fdbb68f38586a2f57804c4567444946be29c988eba1c467cacfdce9
4|004_simplify_runtime_schema.sql|e7e3b94079424215c60b88675e045eeebaf3bd1b4d21256b926858945270c1a0"
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('bitcoin_txid','bitcoin_block','anchor_hash')")" = 0
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('publish_jobs','publish_failures','utxos')")" = 0
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM safety_events WHERE id = '00000000-0000-0000-0000-000000000041' AND nostr_event_id = repeat('a', 64)")" = 1
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM community_reports r JOIN report_authors a ON a.report_id = r.id WHERE r.id = '00000000-0000-0000-0000-000000000042' AND a.nostr_event_id = repeat('d', 64)")" = 1

if compose exec -T postgres sh -c \
  'PGPASSWORD="$APP_DATABASE_PASSWORD" psql -U sentinel_app -d sentinelmesh -c "DELETE FROM schema_versions"'; then
  echo "runtime role unexpectedly altered migration history" >&2
  exit 1
fi

for tampered_version in 3 4; do
  original_checksum=$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
    "SELECT checksum FROM schema_migrations WHERE version = $tampered_version")
  compose exec -T postgres psql -U postgres -d sentinelmesh -v ON_ERROR_STOP=1 \
    -c "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = $tampered_version"
  if compose run --rm migrate; then
    echo "migrator accepted a checksum mismatch for version $tampered_version" >&2
    exit 1
  fi
  compose exec -T postgres psql -U postgres -d sentinelmesh -v ON_ERROR_STOP=1 \
    -c "UPDATE schema_migrations SET checksum = '$original_checksum' WHERE version = $tampered_version"
done
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  'SELECT count(*) FROM schema_migrations WHERE version = 4')" = 1

BACKUP_DIR=/tmp/sentinelmesh-backup-test ./ops/postgres-backup.sh >/tmp/sentinelmesh-backup-path
./ops/postgres-restore-verify.sh "$(cat /tmp/sentinelmesh-backup-path)"

echo "operations smoke test passed"
