#!/bin/sh
set -eu
umask 077

dump=${1:?usage: ops/postgres-restore-verify.sh BACKUP.dump}
postgres_image=${POSTGRES_IMAGE:-sentinelmesh-postgres}
test -f "$dump"
test -f "$dump.sha256"
dump_dir=$(dirname "$dump")
dump_name=$(basename "$dump")
(cd "$dump_dir" && sha256sum --check "$dump_name.sha256")

suffix="$(date +%s)-$$"
container="sentinelmesh-restore-$suffix"
volume="sentinelmesh-restore-$suffix"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

admin_password=$(openssl rand -hex 24)
app_password=$(openssl rand -hex 24)
docker volume create "$volume" >/dev/null
docker run -d --name "$container" --memory=2g --cpus=2 \
  -e POSTGRES_DB=sentinelmesh -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD="$admin_password" -e APP_DATABASE_PASSWORD="$app_password" \
  -v "$volume:/var/lib/postgresql/data" "$postgres_image" >/dev/null

attempt=0
until [ "$(docker exec "$container" sh -c 'cat /proc/1/comm' 2>/dev/null || true)" = "postgres" ] && \
  docker exec -e PGPASSWORD="$app_password" "$container" \
    psql -U sentinel_app -d sentinelmesh -c 'SELECT 1' >/dev/null 2>&1; do
  attempt=$((attempt + 1)); test "$attempt" -lt 90; sleep 2
done
docker exec "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c 'CREATE DATABASE sentinelmesh_restore'
docker exec -i "$container" pg_restore -U postgres -d sentinelmesh_restore \
  --exit-on-error --no-owner < "$dump"

version=$(docker exec "$container" psql -U postgres -d sentinelmesh_restore -Atc \
  'SELECT MAX(version) FROM schema_versions')
test "$version" = "3"

docker exec "$container" psql -U postgres -d sentinelmesh_restore -v ON_ERROR_STOP=1 \
  -c 'SELECT PostGIS_Version()' -c 'SELECT count(*) FROM safety_events' >/dev/null

if docker exec -e PGPASSWORD="$app_password" "$container" \
  psql -U sentinel_app -d sentinelmesh_restore -c 'SELECT * FROM report_authors'; then
  echo "restored runtime role unexpectedly read report_authors" >&2
  exit 1
fi

docker exec -e PGPASSWORD="$app_password" "$container" psql -U sentinel_app \
  -d sentinelmesh_restore -v ON_ERROR_STOP=1 \
  -c 'SET ROLE sentinel_reputation; SELECT count(*) FROM report_authors' >/dev/null

touch "$dump.verified"

echo "restore verification passed for $dump"
