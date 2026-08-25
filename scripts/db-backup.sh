#!/usr/bin/env bash
# HEAT-C008 — database backup. Custom format (pg_dump -Fc), compressed,
# checksummed, named by timestamp. Run from any machine with network access
# to the target instance and pg_dump >= 16.
#
# Usage: DATABASE_URL=postgres://... ./scripts/db-backup.sh [output-dir]
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL required}"
OUT_DIR="${1:-backups}"
mkdir -p "$OUT_DIR"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$OUT_DIR/heat-$STAMP.dump"

echo "→ dumping $DATABASE_URL" | sed -E 's#//[^@]+@#//***@#'
pg_dump --format=custom --no-owner --no-privileges \
        --file "$FILE" "$DATABASE_URL"

SHA=$(shasum -a 256 "$FILE" | awk '{print $1}')
printf '%s  %s\n' "$SHA" "$FILE.sha256" >/dev/null
shasum -a 256 "$FILE" > "$FILE.sha256"

SIZE=$(du -h "$FILE" | awk '{print $1}')
echo "✓ wrote $FILE ($SIZE)"
echo "  sha256 $SHA"
echo "Next: restore-verify into an isolated database (docs/runbooks/restore-db.md)."
