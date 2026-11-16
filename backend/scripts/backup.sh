#!/usr/bin/env bash
# Usage: DATABASE_URL=... scripts/backup.sh [output_dir]
# Writes a custom-format pg_dump (restore with scripts/restore-check.sh or pg_restore). Read-only on the database.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
dir="${1:-./backups}"; mkdir -p "$dir"
file="$dir/nexapos-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --no-privileges --file="$file" "$DATABASE_URL"
pg_restore --list "$file" > /dev/null   # fails if the archive is unreadable
echo "Backup written and readable: $file ($(du -h "$file" | cut -f1))"
