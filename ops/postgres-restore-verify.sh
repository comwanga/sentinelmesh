#!/bin/sh
set -eu
umask 077

dump=${1:?usage: ops/postgres-restore-verify.sh BACKUP.dump}
postgres_image=${POSTGRES_IMAGE:-sentinelmesh-postgres}
test -f "$dump"
test -f "$dump.sha256"
test -f "$dump.schema-version"
test -f "$dump.complete"
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
test "$version" = "10"
manifest=$(docker exec "$container" psql -U postgres -d sentinelmesh_restore -Atc \
  "SELECT version || '|' || description FROM schema_versions ORDER BY version;
   SELECT version || '|' || name || '|' || checksum FROM schema_migrations ORDER BY version")
test "$manifest" = "$(cat "$dump.schema-version")"
expected_manifest="2|SentinelMesh clean V2 baseline
3|003_protect_migration_history.sql
4|004_simplify_runtime_schema.sql
5|005_add_nip05_identity.sql
6|006_add_nip44_circle_key_wrap.sql
7|007_add_targeted_push_outbox.sql
8|008_grant_push_outbox_runtime.sql
9|009_safe_circle_location_envelopes.sql
10|010_circle_membership_lifecycle.sql
3|003_protect_migration_history.sql|d7c41d110fdbb68f38586a2f57804c4567444946be29c988eba1c467cacfdce9
4|004_simplify_runtime_schema.sql|e7e3b94079424215c60b88675e045eeebaf3bd1b4d21256b926858945270c1a0
5|005_add_nip05_identity.sql|77fe3e26e02b444dc5c673af5453f67affe7bd2106d7235778a50f7c1fca1c91
6|006_add_nip44_circle_key_wrap.sql|98085254ae48e12db57e13459ec2a6a425f29f919568475f0597a8a2186b93cb
7|007_add_targeted_push_outbox.sql|a660ca8d78efa63631b2167e02c72d8123f19684c095c56ec45f2cedcf69adc9
8|008_grant_push_outbox_runtime.sql|44bfdd61fafcb1a979853dfed2d2253fa31674b25bac851b2e0def35353bb7ab
9|009_safe_circle_location_envelopes.sql|6eec445a8da9828c3367263140cf296191733428d17c493fdb8c2e34bf2ac6ea
10|010_circle_membership_lifecycle.sql|4f33076c65c4c8a9af8c52a461a3364c730ba3856288418c481fc3958575398f"
test "$manifest" = "$expected_manifest"

docker exec "$container" psql -U postgres -d sentinelmesh_restore -v ON_ERROR_STOP=1 \
  -c 'SELECT PostGIS_Version()' -c 'SELECT count(*) FROM safety_events' \
  -c "DO \$\$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('bitcoin_txid','bitcoin_block','anchor_hash')) THEN
          RAISE EXCEPTION 'obsolete event columns remain';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('publish_jobs','publish_failures','utxos')) THEN
          RAISE EXCEPTION 'obsolete publication tables remain';
        END IF;
        IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name IN ('nip05_identifier','nip05_verified_at','nip05_valid_until')) <> 3 THEN
          RAISE EXCEPTION 'NIP-05 identity columns are incomplete';
        END IF;
        IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'circle_members' AND column_name IN ('key_wrap_version','key_wrap_ciphertext')) <> 2 THEN
          RAISE EXCEPTION 'NIP-44 circle key envelope columns are incomplete';
        END IF;
        IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'circle_members' AND column_name IN ('membership_state','accepted_at','key_wrap_epoch','key_wrap_event')) <> 4 THEN
          RAISE EXCEPTION 'circle membership lifecycle columns are incomplete';
        END IF;
        IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'circles' AND column_name = 'membership_revision') <> 1 THEN
          RAISE EXCEPTION 'circle membership revision column is missing';
        END IF;
        IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'location_blobs' AND column_name IN ('protocol_version','key_epoch','sender_token','ciphertext','ciphertext_hash','created_at','expires_at')) <> 7 THEN
          RAISE EXCEPTION 'safe location envelope columns are incomplete';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'location_blobs' AND column_name IN ('recipient_token','sender_ephemeral_pubkey','encrypted_payload')) THEN
          RAISE EXCEPTION 'legacy location envelope columns remain';
        END IF;
        IF (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'push_deliveries') <> 1 THEN
          RAISE EXCEPTION 'push delivery outbox is missing';
        END IF;
        IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'push_subscriptions' AND column_name IN ('min_severity','center_lat','center_lng','radius_km','center_geog')) <> 5 THEN
          RAISE EXCEPTION 'push targeting columns are incomplete';
        END IF;
      END \$\$" >/dev/null

if docker exec -e PGPASSWORD="$app_password" "$container" \
  psql -U sentinel_app -d sentinelmesh_restore -c 'SELECT * FROM report_authors'; then
  echo "restored runtime role unexpectedly read report_authors" >&2
  exit 1
fi

docker exec -e PGPASSWORD="$app_password" "$container" psql -U sentinel_app \
  -d sentinelmesh_restore -v ON_ERROR_STOP=1 \
  -c 'SELECT count(*) FROM push_deliveries' \
  -c 'SET ROLE sentinel_reputation; SELECT count(*) FROM report_authors' >/dev/null

touch "$dump.verified"

echo "restore verification passed for $dump"
