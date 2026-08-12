#!/bin/sh
set -eu

: "${PUBLIC_READY_URL:?PUBLIC_READY_URL is required}"
backup_dir=${BACKUP_DIR:-./backups}
max_backup_age_hours=${MAX_BACKUP_AGE_HOURS:-30}
max_disk_percent=${MAX_DISK_PERCENT:-80}
failures=""

if ! curl -fsS --max-time 10 "$PUBLIC_READY_URL" >/dev/null; then
  failures="$failures readiness"
fi

compose_state=$(./ops/compose.sh ps --format json 2>&1) || failures="$failures containers"
for service in postgres redis gateway-rs nginx; do
  echo "$compose_state" | grep -q "\"Service\":\"$service\"" || failures="$failures containers"
done
unhealthy=$(printf '%s' "$compose_state" | grep -E '"Health":"unhealthy"|"State":"(exited|restarting|dead)"' || true)
if [ -n "$unhealthy" ]; then failures="$failures containers"; fi

disk_percent=$(df -P . | tail -1 | tr -s ' ' | cut -d ' ' -f 5 | tr -d '%')
if [ "$disk_percent" -ge "$max_disk_percent" ]; then failures="$failures disk"; fi

latest_backup=$(ls -1t "$backup_dir"/*.dump.verified 2>/dev/null | sed -n '1p')
if [ -z "$latest_backup" ]; then
  failures="$failures backup"
else
  dump=${latest_backup%.verified}
  if [ ! -s "$dump" ] || [ ! -f "$dump.sha256" ] || \
    ! (cd "$backup_dir" && sha256sum --check "$(basename "$dump").sha256" >/dev/null 2>&1); then
    failures="$failures backup"
  fi
  now=$(date +%s)
  modified=$(stat -c %Y "$latest_backup")
  age_hours=$(( (now - modified) / 3600 ))
  if [ "$age_hours" -gt "$max_backup_age_hours" ]; then failures="$failures backup"; fi
fi

if [ -n "$failures" ]; then
  message="SentinelMesh operations check failed:$failures"
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -X POST -H 'Content-Type: application/json' \
      --data "{\"text\":\"$message\"}" "$ALERT_WEBHOOK_URL" >/dev/null || true
  fi
  echo "$message" >&2
  exit 1
fi

echo "operations check passed"
