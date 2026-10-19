#!/usr/bin/env bash
# Runs every migration, in order, on a throwaway Postgres database and then every SQL test.
# Uses the standard PG* environment variables (PGHOST, PGPORT, PGUSER, PGPASSWORD).
# The stub file stands in for the parts of Supabase (auth schema, roles) that plain Postgres lacks.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="mediflow_test_$$"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
run() { psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$1" 2>&1 | grep -v "NOTICE" || true; }

echo "▸ stub"; psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/_supabase_stub.sql >/dev/null
for f in supabase/migrations/*.sql; do
  case "$f" in *002_demo*) continue;; esac       # demo data only
  echo "▸ migrate $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null 2>/tmp/mig_err_$$ || { cat /tmp/mig_err_$$; exit 1; }
done
echo "▸ migrations are re-runnable"
for f in supabase/migrations/*.sql; do
  case "$f" in *002_demo*|*001_schema*) continue;; esac
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null 2>/tmp/mig_err_$$ || { echo "re-run failed: $f"; cat /tmp/mig_err_$$; exit 1; }
done
fail=0
for t in supabase/tests/*_test.sql; do
  out=$(psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$t" 2>&1) && ok=1 || ok=0
  if [ $ok = 1 ] && echo "$out" | grep -q "PASSED"; then echo "✔ $(basename "$t")"; else echo "✘ $(basename "$t")"; echo "$out" | grep -v NOTICE | tail -15; fail=1; fi
done
exit $fail
