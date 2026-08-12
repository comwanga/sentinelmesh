#!/bin/sh
set -eu

: "${APP_DATABASE_PASSWORD:?APP_DATABASE_PASSWORD is required}"

psql --set ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set app_password="$APP_DATABASE_PASSWORD" <<'SQL'
CREATE ROLE sentinel_app
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  PASSWORD :'app_password';
CREATE ROLE sentinel_reputation NOLOGIN NOINHERIT;
GRANT sentinel_reputation TO sentinel_app WITH INHERIT FALSE;
SQL
