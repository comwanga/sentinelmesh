#!/bin/sh
set -eu

: "${PUBLIC_BASE_URL:?PUBLIC_BASE_URL is required}"
: "${POSTGRES_ADMIN_PASSWORD:?POSTGRES_ADMIN_PASSWORD is required}"
: "${APP_DATABASE_PASSWORD:?APP_DATABASE_PASSWORD is required}"
: "${REDIS_PASSWORD:?REDIS_PASSWORD is required}"
: "${INTERNAL_SERVICE_SECRET:?INTERNAL_SERVICE_SECRET is required}"
: "${CIRCLE_TOKEN_SECRET:?CIRCLE_TOKEN_SECRET is required}"
: "${SENTINEL_BIND_ADDRESS:?SENTINEL_BIND_ADDRESS is required}"

for command_name in docker curl openssl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "$command_name is required" >&2
    exit 1
  }
done
test "$(uname -s)" = Linux || {
  echo "the single-host production tooling currently requires GNU/Linux" >&2
  exit 1
}
stat -c %Y . >/dev/null 2>&1 || {
  echo "GNU stat is required" >&2
  exit 1
}
./ops/compose.sh version >/dev/null 2>&1 || {
  echo "Docker Compose v2 is required" >&2
  exit 1
}

case "$PUBLIC_BASE_URL" in
  https://*) ;;
  *) echo "PUBLIC_BASE_URL must use HTTPS in production" >&2; exit 1 ;;
esac

case "$SENTINEL_BIND_ADDRESS" in
  127.0.0.1|::1) ;;
  *) echo "production ingress must bind to loopback behind the trusted TLS proxy" >&2; exit 1 ;;
esac

for secret_name in POSTGRES_ADMIN_PASSWORD APP_DATABASE_PASSWORD REDIS_PASSWORD INTERNAL_SERVICE_SECRET CIRCLE_TOKEN_SECRET; do
  eval "secret=\${$secret_name}"
  case "$secret" in
    *replace*|*changeme*|*example*|*password)
      echo "$secret_name still looks like a placeholder" >&2
      exit 1
      ;;
  esac
  if [ "${#secret}" -lt 24 ]; then
    echo "$secret_name must contain at least 24 characters" >&2
    exit 1
  fi
done

if [ -f .env ]; then
  env_mode=$(stat -c %a .env)
  case "$env_mode" in
    600|400) ;;
    *) echo ".env must have mode 0600 or 0400" >&2; exit 1 ;;
  esac
fi

disk_percent=$(df -P . | tail -1 | tr -s ' ' | cut -d ' ' -f 5 | tr -d '%')
if [ "$disk_percent" -ge 80 ]; then
  echo "deployment filesystem is at least 80% full" >&2
  exit 1
fi

./ops/compose.sh -f docker-compose.yml -f docker-compose.production.yml config --quiet
echo "production preflight passed"
