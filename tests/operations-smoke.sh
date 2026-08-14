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
INSERT INTO users (nostr_pubkey, reputation_score, reputation_tier, total_reports)
VALUES (repeat('e', 64), 17, 'ESTABLISHED', 4);
INSERT INTO circles (id, owner_token, name_ciphertext, name_version)
VALUES ('00000000-0000-0000-0000-000000000043', 'v1:owner', 'ciphertext', 1);
INSERT INTO circle_members (circle_id, member_token, member_label_ciphertext)
VALUES ('00000000-0000-0000-0000-000000000043', 'v1:member', 'label-ciphertext');
SQL
compose run --rm migrate >/tmp/sentinelmesh-migrate-a-$$ 2>&1 & migrate_a=$!
compose run --rm migrate >/tmp/sentinelmesh-migrate-b-$$ 2>&1 & migrate_b=$!
wait "$migrate_a"
wait "$migrate_b"
rm -f /tmp/sentinelmesh-migrate-a-$$ /tmp/sentinelmesh-migrate-b-$$
compose run --rm migrate

version=$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  'SELECT MAX(version) FROM schema_versions')
test "$version" = "9"
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT string_agg(version || '|' || name || '|' || checksum, E'\\n' ORDER BY version) FROM schema_migrations")" = "3|003_protect_migration_history.sql|d7c41d110fdbb68f38586a2f57804c4567444946be29c988eba1c467cacfdce9
4|004_simplify_runtime_schema.sql|e7e3b94079424215c60b88675e045eeebaf3bd1b4d21256b926858945270c1a0
5|005_add_nip05_identity.sql|77fe3e26e02b444dc5c673af5453f67affe7bd2106d7235778a50f7c1fca1c91
6|006_add_nip44_circle_key_wrap.sql|98085254ae48e12db57e13459ec2a6a425f29f919568475f0597a8a2186b93cb
7|007_add_targeted_push_outbox.sql|a660ca8d78efa63631b2167e02c72d8123f19684c095c56ec45f2cedcf69adc9
8|008_grant_push_outbox_runtime.sql|44bfdd61fafcb1a979853dfed2d2253fa31674b25bac851b2e0def35353bb7ab
9|009_safe_circle_location_envelopes.sql|6eec445a8da9828c3367263140cf296191733428d17c493fdb8c2e34bf2ac6ea"
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('bitcoin_txid','bitcoin_block','anchor_hash')")" = 0
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('publish_jobs','publish_failures','utxos')")" = 0
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM safety_events WHERE id = '00000000-0000-0000-0000-000000000041' AND nostr_event_id = repeat('a', 64)")" = 1
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM community_reports r JOIN report_authors a ON a.report_id = r.id WHERE r.id = '00000000-0000-0000-0000-000000000042' AND a.nostr_event_id = repeat('d', 64)")" = 1
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM users WHERE nostr_pubkey = repeat('e', 64) AND reputation_score = 17 AND reputation_tier = 'ESTABLISHED' AND total_reports = 4 AND nip05_identifier IS NULL")" = 1
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name IN ('nip05_identifier','nip05_verified_at','nip05_valid_until')")" = 3
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM circle_members WHERE circle_id = '00000000-0000-0000-0000-000000000043' AND member_token = 'v1:member' AND member_label_ciphertext = 'label-ciphertext' AND key_wrap_version IS NULL AND key_wrap_ciphertext IS NULL")" = 1
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'circle_members' AND column_name IN ('key_wrap_version','key_wrap_ciphertext')")" = 2
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM circles WHERE id = '00000000-0000-0000-0000-000000000043' AND key_epoch = 1 AND location_protocol_version = 0 AND rekey_required")" = 1
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'location_blobs' AND column_name IN ('protocol_version','key_epoch','sender_token','ciphertext','ciphertext_hash','created_at','expires_at')")" = 7
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'location_blobs' AND column_name IN ('recipient_token','sender_ephemeral_pubkey','encrypted_payload')")" = 0
compose exec -T postgres psql -U postgres -d sentinelmesh -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO location_blobs
  (circle_id, protocol_version, key_epoch, sender_token, ciphertext, ciphertext_hash, created_at, expires_at)
VALUES
  ('00000000-0000-0000-0000-000000000043', 1, 1, 'v1:expired-sender', 'AQ==', decode(repeat('01', 32), 'hex'), now() - interval '4 minutes', now() - interval '1 minute');
INSERT INTO location_blobs
  (circle_id, protocol_version, key_epoch, sender_token, ciphertext, ciphertext_hash, created_at, expires_at)
VALUES
  ('00000000-0000-0000-0000-000000000043', 1, 1, 'v1:upsert-sender', 'Ag==', decode(repeat('03', 32), 'hex'), now(), now() + interval '1 minute')
ON CONFLICT (circle_id, sender_token) DO UPDATE SET
  id = gen_random_uuid(), ciphertext = EXCLUDED.ciphertext, ciphertext_hash = EXCLUDED.ciphertext_hash,
  created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at;
INSERT INTO location_blobs
  (circle_id, protocol_version, key_epoch, sender_token, ciphertext, ciphertext_hash, created_at, expires_at)
VALUES
  ('00000000-0000-0000-0000-000000000043', 1, 1, 'v1:upsert-sender', 'Aw==', decode(repeat('04', 32), 'hex'), now(), now() + interval '2 minutes')
ON CONFLICT (circle_id, sender_token) DO UPDATE SET
  id = gen_random_uuid(), ciphertext = EXCLUDED.ciphertext, ciphertext_hash = EXCLUDED.ciphertext_hash,
  created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at;
DELETE FROM location_blobs WHERE expires_at <= now();
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM location_blobs WHERE sender_token = 'v1:expired-sender') THEN
    RAISE EXCEPTION 'expired location cleanup failed';
  END IF;
  IF (SELECT count(*) FROM location_blobs WHERE sender_token = 'v1:upsert-sender' AND ciphertext = 'Aw==') <> 1 THEN
    RAISE EXCEPTION 'location sender upsert did not retain exactly one current envelope';
  END IF;
END $$;
SQL
if compose exec -T postgres psql -U postgres -d sentinelmesh -v ON_ERROR_STOP=1 -c \
  "INSERT INTO location_blobs (circle_id, protocol_version, key_epoch, sender_token, ciphertext, ciphertext_hash, created_at, expires_at) VALUES ('00000000-0000-0000-0000-000000000043', 1, 1, 'v1:bad-expiry', 'AQ==', decode(repeat('02', 32), 'hex'), now(), now() + interval '6 minutes')"; then
  echo "location envelope expiry constraint accepted more than five minutes" >&2
  exit 1
fi
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'push_deliveries'")" = 1
test "$(compose exec -T postgres psql -U postgres -d sentinelmesh -Atc \
  "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'push_subscriptions' AND column_name IN ('min_severity','center_lat','center_lng','radius_km','center_geog')")" = 5
test "$(compose exec -T postgres sh -c \
  'PGPASSWORD="$APP_DATABASE_PASSWORD" psql -U sentinel_app -d sentinelmesh -Atc "SELECT has_table_privilege(current_user, '\''push_deliveries'\'', '\''SELECT'\'') AND has_table_privilege(current_user, '\''push_deliveries'\'', '\''INSERT'\'') AND has_table_privilege(current_user, '\''push_deliveries'\'', '\''UPDATE'\'') AND has_table_privilege(current_user, '\''push_deliveries'\'', '\''DELETE'\'')"')" = t
if compose exec -T postgres psql -U postgres -d sentinelmesh -v ON_ERROR_STOP=1 \
  -c "UPDATE users SET nip05_identifier = 'incomplete@example.com' WHERE nostr_pubkey = repeat('e', 64)"; then
  echo "NIP-05 all-or-none constraint accepted incomplete identity state" >&2
  exit 1
fi
if compose exec -T postgres psql -U postgres -d sentinelmesh -v ON_ERROR_STOP=1 \
  -c "UPDATE circle_members SET key_wrap_version = 2 WHERE circle_id = '00000000-0000-0000-0000-000000000043'"; then
  echo "NIP-44 all-or-none constraint accepted an incomplete envelope" >&2
  exit 1
fi

if compose exec -T postgres sh -c \
  'PGPASSWORD="$APP_DATABASE_PASSWORD" psql -U sentinel_app -d sentinelmesh -c "DELETE FROM schema_versions"'; then
  echo "runtime role unexpectedly altered migration history" >&2
  exit 1
fi

for tampered_version in 3 4 5 6 7 8 9; do
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
  'SELECT count(*) FROM schema_migrations WHERE version = 9')" = 1

BACKUP_DIR=/tmp/sentinelmesh-backup-test ./ops/postgres-backup.sh >/tmp/sentinelmesh-backup-path
./ops/postgres-restore-verify.sh "$(cat /tmp/sentinelmesh-backup-path)"

echo "operations smoke test passed"
