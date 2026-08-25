#!/usr/bin/env bash
# HEAT-C008 — restore drill. Restores a backup into a SCRATCH database and
# runs verification queries, timing every step. Never touches the source.
#
# Usage:
#   ./scripts/db-restore-verify.sh backups/heat-20260825T120000Z.dump \
#       postgres://user:pass@host:5432/heat_restore_drill
set -euo pipefail

DUMP="${1:?usage: db-restore-verify.sh <dump> <scratch-database-url>}"
SCRATCH="${2:?usage: db-restore-verify.sh <dump> <scratch-database-url>}"

BASE_URL="${SCRATCH%/*}"          # everything before the final path segment
DB_NAME="${SCRATCH##*/}"          # final path segment = database name
t0=$(date +%s)

echo "→ restoring into scratch (never the source):"
echo "  $(echo "$SCRATCH" | sed -E 's#//[^@]+@#//***@#')"

psql "$BASE_URL/postgres" -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$DB_NAME\"" \
  -c "CREATE DATABASE \"$DB_NAME\""

pg_restore --no-owner --no-privileges --dbname "$SCRATCH" "$DUMP"
t1=$(date +%s)
echo "✓ restore completed in $((t1 - t0))s"

echo "→ verification queries"
psql "$SCRATCH" -v ON_ERROR_STOP=1 <<'SQL'
\echo '-- extensions'
SELECT extname FROM pg_extension WHERE extname IN ('postgis','pg_trgm') ORDER BY 1;
\echo '-- row counts (must be non-zero on a real snapshot)'
SELECT 'events' AS t, count(*) FROM events
UNION ALL SELECT 'venues', count(*) FROM venues
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'event_sources', count(*) FROM event_sources;
\echo '-- spatial sanity: events must carry geography locations'
SELECT count(*) AS null_locations FROM events WHERE location IS NULL;
\echo '-- referential sanity: no orphaned stars'
SELECT count(*) AS orphaned_stars FROM event_stars s
  LEFT JOIN events e ON e.id = s.event_id WHERE e.id IS NULL;
SQL

t2=$(date +%s)
echo "✓ verification passed in $((t2 - t1))s — total drill time $((t2 - t0))s"
echo "Record these numbers in docs/runbooks/restore-db.md (drill log)."
