# PostgreSQL Schema

`schema-v2.sql` is the only active fresh-install schema. The files under `migrations/` and the former `init.sql` describe the pre-V2 prototype and must not be replayed after this baseline.

The container bootstrap creates:

- `postgres`: administrative bootstrap account, never used by the application
- `sentinel_app`: non-superuser runtime account
- `sentinel_reputation`: restricted role used through explicit `SET ROLE`

`schema-v2.sql` is the immutable clean baseline. Active populated-database migrations live under `migrations-v2/` and are applied only by `migrate.sh`, which serializes execution and validates checksums. Released migration files are never edited; corrections use a new monotonically numbered migration.

The runtime role may read migration history but cannot alter it. Gateway startup requires the exact current version. Use `make migrate` for an existing volume and follow `docs/operations/production-runbook.md` for backup and restore procedures.
