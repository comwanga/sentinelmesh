# PostgreSQL Schema

`schema-v2.sql` is the only active fresh-install schema. The files under `migrations/` and the former `init.sql` describe the pre-V2 prototype and must not be replayed after this baseline.

The container bootstrap creates:

- `postgres`: administrative bootstrap account, never used by the application
- `sentinel_app`: non-superuser runtime account
- `sentinel_reputation`: restricted role used through explicit `SET ROLE`

This V2 baseline intentionally supports clean databases only. Future populated-schema changes must use new transactional migrations with explicit expand, backfill, verify, and contract stages.
