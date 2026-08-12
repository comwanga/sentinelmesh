#!/bin/sh
set -eu
export COMPOSE_BAKE=${COMPOSE_BAKE:-false}

if docker compose version >/dev/null 2>&1; then
  exec docker compose "$@"
fi
if command -v docker-compose >/dev/null 2>&1; then
  exec docker-compose "$@"
fi

echo "Docker Compose v2 is required" >&2
exit 1
