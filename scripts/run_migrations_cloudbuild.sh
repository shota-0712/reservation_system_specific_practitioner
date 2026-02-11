#!/usr/bin/env bash
set -euo pipefail

RUN_MIGRATIONS="${RUN_MIGRATIONS:-false}"
CLOUDSQL_INSTANCE="${CLOUDSQL_INSTANCE:-}"
DB_USER="${DB_USER:-app_user}"
DB_NAME="${DB_NAME:-reservation_system}"

if [ "${RUN_MIGRATIONS}" != "true" ]; then
  echo "Skip DB migrations (RUN_MIGRATIONS=${RUN_MIGRATIONS})"
  exit 0
fi

if [ -z "${CLOUDSQL_INSTANCE}" ]; then
  echo "CLOUDSQL_INSTANCE is required when RUN_MIGRATIONS=true"
  exit 1
fi

DB_PASSWORD="$(gcloud secrets versions access latest --secret=db-password)"
export PGPASSWORD="${DB_PASSWORD}"

for file in database/migrations/*.sql; do
  filename="$(basename "${file}")"
  if command -v sha256sum >/dev/null 2>&1; then
    checksum="$(sha256sum "${file}" | awk '{print $1}')"
  else
    checksum="$(shasum -a 256 "${file}" | awk '{print $1}')"
  fi
  echo "Checking migration: ${filename}"

  cat <<SQL | gcloud sql connect "${CLOUDSQL_INSTANCE}" \
    --user="${DB_USER}" \
    --database="${DB_NAME}" \
    --quiet
\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  checksum TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT EXISTS(
  SELECT 1 FROM schema_migrations WHERE filename = '${filename}'
) AS already_applied \gset

\if :already_applied
\echo 'Skip migration: ${filename}'
\else
\echo 'Apply migration: ${filename}'
\i ${file}
INSERT INTO schema_migrations (filename, checksum, applied_at)
VALUES ('${filename}', '${checksum}', NOW())
ON CONFLICT (filename) DO NOTHING;
\endif
SQL
done
