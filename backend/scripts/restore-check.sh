#!/usr/bin/env bash
# Usage: scripts/restore-check.sh backup.dump <admin_url_to_scratch_server> <scratch_db_name>
# Restores a backup into a NEW scratch database and runs the data audit against it.
# Refuses to touch an existing database: it will not drop or overwrite anything.
set -euo pipefail
dump="${1:?backup file}"; admin="${2:?admin URL, e.g. postgresql://postgres@localhost:5432/postgres}"; db="${3:?new scratch db name}"
if [ "$(psql "$admin" -Atc "select count(*) from pg_database where datname='$db'")" != "0" ]; then
  echo "Database $db already exists - refusing to overwrite. Pick a new name." >&2; exit 1
fi
psql "$admin" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\""
target="${admin%/*}/$db"
pg_restore --no-owner --no-privileges --dbname="$target" "$dump"
psql "$target" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/audit-data.sql"
echo "Restore OK into $db (drop it yourself when done)."
