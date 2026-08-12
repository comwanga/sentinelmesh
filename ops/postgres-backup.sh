#!/bin/sh
set -eu
umask 077

backup_dir=${BACKUP_DIR:-./backups}
mkdir -p "$backup_dir"
chmod 0700 "$backup_dir"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
suffix="${timestamp}-$$"
dump="$backup_dir/sentinelmesh-$suffix.dump"
temporary="$dump.tmp"
trap 'rm -f "$temporary"' EXIT INT TERM
test ! -e "$dump"

./ops/compose.sh exec -T postgres sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner' \
  > "$temporary"

test -s "$temporary"
./ops/compose.sh exec -T postgres pg_restore --list < "$temporary" >/dev/null
mv "$temporary" "$dump"
(cd "$backup_dir" && sha256sum "$(basename "$dump")") > "$dump.sha256.tmp"
./ops/compose.sh exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  'SELECT MAX(version) FROM schema_versions' > "$dump.schema-version.tmp"
mv "$dump.sha256.tmp" "$dump.sha256"
mv "$dump.schema-version.tmp" "$dump.schema-version"
touch "$dump.complete"

echo "$dump"
