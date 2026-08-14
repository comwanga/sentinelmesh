# Core Production Runbook

This runbook covers the supported single-host V2 core: PostgreSQL, Redis, the Rust gateway, and the Nginx/PWA container. Signal and ML profiles remain experimental and are not production-supported by this procedure.

## Topology

The Compose ingress binds to loopback only. A trusted host-level reverse proxy or load balancer must terminate TLS, forward requests to `127.0.0.1:SENTINEL_HTTP_PORT`, and **replace** client-supplied `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Port` headers with sanitized values. Only TCP 443 from the internet and the operator's SSH port should be allowed by the host firewall. PostgreSQL, Redis, and the gateway are never published.

Recommended minimum host capacity is 4 CPU cores, 8 GB RAM, and monitored encrypted storage with at least twice the current database size free. Production volume names are stable and independent of the checkout directory.

## Configuration

Create `.env` outside source control. Required production values include:

```dotenv
POSTGRES_ADMIN_PASSWORD=<random 32+ characters>
APP_DATABASE_PASSWORD=<random 32+ characters>
REDIS_PASSWORD=<random 32+ characters>
INTERNAL_SERVICE_SECRET=<random 32+ characters>
CIRCLE_TOKEN_SECRET=<random 32+ characters; keep stable>
PUBLIC_BASE_URL=https://alerts.example.org
SENTINEL_BIND_ADDRESS=127.0.0.1
SENTINEL_HTTP_PORT=8080
POSTGRES_VOLUME_NAME=sentinelmesh-production-pgdata
REDIS_VOLUME_NAME=sentinelmesh-production-redisdata
```

Generate secrets with `openssl rand -hex 32`. Restrict `.env` to the deployment account with mode `0600`. Docker daemon access is equivalent to root and exposes container environment variables; restrict it accordingly. Rotating `CIRCLE_TOKEN_SECRET` invalidates existing circle tokens and requires a planned data migration.

Validate configuration before every rollout:

```bash
set -a; . ./.env; set +a
make prod-config
```

## Deployment

1. Confirm the TLS proxy certificate and upstream health configuration.
2. Take and copy an encrypted backup off-host.
3. Pull the reviewed release revision or immutable images.
4. Run `make prod-config`.
5. Run `make prod-up`.
6. Confirm migration completion with `docker compose logs migrate`.
7. Check `https://alerts.example.org/live`, `/ready`, `/`, and `/api/events?limit=1`.
8. Confirm the external uptime monitor receives HTTP 200 from `/ready`.

The one-shot migrator serializes with a PostgreSQL advisory lock, validates immutable migration checksums, and records each applied version. Gateway startup requires exactly schema version 6. A migration failure prevents the gateway from starting.

Applied migrations are immutable. Never edit a released file under `infra/postgres/migrations-v2`; add the next numbered migration instead. Database rollback is restore or a reviewed forward fix, not an ad hoc down migration.

## Backup

`make backup` creates a private custom-format logical dump, SHA-256 checksum, schema-version sidecar, and `.complete` marker under `BACKUP_DIR` (default `./backups`). This local file is only a staging artifact. A `.verified` marker is created only after the restore drill succeeds.

```bash
BACKUP_DIR=/srv/sentinelmesh/backups make backup
```

Encrypt and copy backups to versioned off-host storage. Run at least daily, retain 7 daily and 4 weekly copies, and alert if no successful backup exists for 30 hours. For an RPO below 24 hours, enable provider or PostgreSQL WAL/PITR in addition to logical dumps.

## Restore Drill

Verify every release backup and perform an automated drill at least weekly:

```bash
make restore-verify BACKUP=/srv/sentinelmesh/backups/sentinelmesh-YYYYMMDDTHHMMSSZ.dump
```

The drill verifies the checksum, restores into a disposable resource-limited PostgreSQL container and volume, checks schema version and PostGIS, and confirms the `report_authors` role boundary. A backup is not considered successful until this drill passes.

For disaster recovery, provision an empty PostgreSQL volume, start PostgreSQL, restore with `pg_restore --exit-on-error --no-owner`, run `make migrate`, then complete all readiness and smoke checks before switching traffic.

## Monitoring

Run `ops/watchdog.sh` every five minutes from a host timer with:

```dotenv
PUBLIC_READY_URL=https://alerts.example.org/ready
BACKUP_DIR=/srv/sentinelmesh/backups
MAX_BACKUP_AGE_HOURS=30
MAX_DISK_PERCENT=80
ALERT_WEBHOOK_URL=https://monitor.example/hooks/...
```

The watchdog alerts on public readiness failure, exited/restarting/unhealthy containers, disk pressure, and missing/stale backups. Also configure an external uptime monitor for `/ready`; host-local checks cannot report total host, DNS, certificate, or network failure.

Docker logs are bounded to five 10 MB files per core service. During incidents use `docker compose logs --since 30m SERVICE`, record container restart/health status, and avoid pasting secrets or report identities into tickets.

## Failure Response

- `/live` fails: inspect/restart the gateway process and recent container logs.
- `/live` succeeds but `/ready` fails: inspect PostgreSQL, Redis, worker status, and migration logs. Readiness failure does not itself restart a container.
- Migration fails: stop the rollout, preserve logs, and restore the pre-deploy backup or ship a reviewed forward fix.
- Disk exceeds 80%: stop log growth, move verified backups off-host, and expand storage before restarting write-heavy services.
- Redis loss: report/event synchronization may need reconciliation; PostgreSQL remains the durable source of application records.

## Destructive Commands

`make down-clean` deletes local volumes and all PostgreSQL/Redis data. It is development-only and must never be used on a production host.

## Chat Operations (experimental)

Chat stays off unless `VITE_ENABLE_CHAT` and `CHAT_PUSH_ENABLED` are explicitly set.
See `docs/operations/relay-conformance.md` for the required relay pinning and
conformance checks before enabling it.

- `RELAY_WEBHOOK_SECRET` is a distinct, strong secret shared only with the inbox
  relay. `RELAY_WEBHOOK_ALLOWED_SOURCE` optionally pins the `X-Relay-Source` header.
- Back up the community and inbox relay databases and their private keys separately;
  losing the community relay key breaks NIP-29 state verification for clients.
- Enforce the decided gift-wrap retention (default 90 days) at the inbox relay and
  public history at the community relay.
- Monitor accepted/rejected writes, AUTH failures, subscription counts, webhook lag,
  and `chat_push_deliveries` dead letters.
- The gateway never decrypts DMs; push notifications carry only "New encrypted
  message" and never sender, recipient, ciphertext, or participant lists.
- Abuse workflow: operator moderation of public channels is relay-side (NIP-29);
  DM abuse is mitigated locally by the client (block/mute/quarantine). Operator
  escalation of private evidence requires explicit user consent.
