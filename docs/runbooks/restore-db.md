# Runbook — Restore the database (with drill log)

A backup that has never been restored is not a proven backup (HEAT-C008).
This procedure doubles as the pre-beta drill and the incident path.

## Procedure

```bash
# 1. Create a backup (source stays untouched)
DATABASE_URL=<source-url> ./scripts/db-backup.sh backups/

# 2. Restore into an ISOLATED scratch database + verify
./scripts/db-restore-verify.sh backups/heat-<stamp>.dump \
    postgres://<user>:<pass>@<host>:5432/heat_restore_drill
```

Verification queries inside the script check extensions, row counts, spatial
decodability, and orphaned stars. Record every drill below.

## Incident variant (real data loss)

1. Stop API replicas (maintenance mode) — no writes during recovery.
2. Pick the newest backup BEFORE the damage window; if PITR is available on
   the managed provider, prefer point-in-time to just-before-damage instead
   of the dump.
3. Restore into a NEW instance; re-run verification queries by hand.
4. Repoint `DATABASE_URL`, run migrations (`migrateCli up`) to confirm schema
   headroom, restart replicas, flip out of maintenance.
5. Post-mortem: how did damage happen, why did detection take that long.

## Drill log

| Date | Backup | Restored in | Verified in | Total | Operator |
|---|---|---|---|---|---|
| 2026-08-25 | local dev stack (`heat-20260825T173959Z.dump`, sha256 d5687a91…) | <1s | <1s | ~1s | codex-agent (drill: 219 events / 18 venues / 137 users / 219 sources; 0 null locations; 0 orphaned stars) |
| _(staging provision drill pending HEAT-C001)_ | | | | | |

Tooling note: client version must match the server major (PG16 server ⇒
`pg_dump`/`pg_restore` 16.x). A v18 client emits `SET transaction_timeout`
which PG16 servers reject during restore.
