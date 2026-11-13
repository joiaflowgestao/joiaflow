#!/usr/bin/env bash
# Testa migrations + RLS num PostgreSQL LOCAL descartável (nunca no projeto real).
# Uso: PGURL=postgres://postgres@localhost:5432/postgres ./supabase/tests/run.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
PGURL="${PGURL:-postgres://postgres@localhost:5432/postgres}"
psql "$PGURL" -q -c 'drop database if exists joiaflow_test' -c 'create database joiaflow_test'
TEST_URL="${PGURL%/*}/joiaflow_test"
for f in "$DIR/00_supabase_stub.sql" "$DIR"/../migrations/*.sql "$DIR/99_default_grants.sql"; do
  psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f "$f"
done
psql "$TEST_URL" -q -tA -v ON_ERROR_STOP=1 -f "$DIR/rls_isolation_test.sql" | grep -v '^$' | tee /tmp/joiaflow_rls.txt
! grep -q '^FAIL' /tmp/joiaflow_rls.txt
