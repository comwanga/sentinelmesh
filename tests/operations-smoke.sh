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
compose run --rm migrate
compose run --rm migrate

version=$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  'SELECT MAX(version) FROM schema_versions')
test "$version" = "3"

if compose exec -T postgres sh -c \
  'PGPASSWORD="$APP_DATABASE_PASSWORD" psql -U sentinel_app -d sentinelmesh -c "DELETE FROM schema_versions"'; then
  echo "runtime role unexpectedly altered migration history" >&2
  exit 1
fi

compose exec -T postgres psql -U postgres -d sentinelmesh -v ON_ERROR_STOP=1 \
  -c "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 3"
if compose run --rm migrate; then
  echo "migrator accepted a checksum mismatch" >&2
  exit 1
fi
compose exec -T postgres psql -U postgres -d sentinelmesh -v ON_ERROR_STOP=1 \
  -c "DELETE FROM schema_migrations WHERE version = 3; DELETE FROM schema_versions WHERE version = 3"
compose run --rm migrate >/tmp/sentinelmesh-migrate-a-$$ 2>&1 & migrate_a=$!
compose run --rm migrate >/tmp/sentinelmesh-migrate-b-$$ 2>&1 & migrate_b=$!
wait "$migrate_a"
wait "$migrate_b"
rm -f /tmp/sentinelmesh-migrate-a-$$ /tmp/sentinelmesh-migrate-b-$$
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  'SELECT count(*) FROM schema_migrations WHERE version = 3')" = 1

BACKUP_DIR=/tmp/sentinelmesh-backup-test ./ops/postgres-backup.sh >/tmp/sentinelmesh-backup-path
./ops/postgres-restore-verify.sh "$(cat /tmp/sentinelmesh-backup-path)"

echo "operations smoke test passed"
