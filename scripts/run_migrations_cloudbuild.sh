#!/usr/bin/env bash
set -euo pipefail

RUN_MIGRATIONS="${RUN_MIGRATIONS:-false}"
CLOUDSQL_INSTANCE="${CLOUDSQL_INSTANCE:-}"
DB_USER="${DB_USER:-app_user}"
DB_NAME="${DB_NAME:-reservation_system}"
MIGRATION_LOCK_TIMEOUT="${MIGRATION_LOCK_TIMEOUT:-5s}"
MIGRATION_STATEMENT_TIMEOUT="${MIGRATION_STATEMENT_TIMEOUT:-15min}"

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
  version="${filename%%_*}"
  version="${version%.sql}"
  if command -v sha256sum >/dev/null 2>&1; then
    checksum="$(sha256sum "${file}" | awk '{print $1}')"
  else
    checksum="$(shasum -a 256 "${file}" | awk '{print $1}')"
  fi
  echo "Checking migration: ${filename} (version=${version}, checksum=${checksum})"

  cat <<SQL | gcloud sql connect "${CLOUDSQL_INSTANCE}" \
    --user="${DB_USER}" \
    --database="${DB_NAME}" \
    --quiet
\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  version VARCHAR(64),
  checksum TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_version
  ON schema_migrations (version);

SELECT checksum AS existing_checksum
FROM schema_migrations
WHERE filename = '${filename}' \gset

SELECT EXISTS(
  SELECT 1 FROM schema_migrations WHERE filename = '${filename}'
) AS already_applied \gset

SELECT (
  NOT EXISTS(SELECT 1 FROM schema_migrations WHERE filename = '${filename}')
  OR EXISTS(
    SELECT 1
    FROM schema_migrations
    WHERE filename = '${filename}'
      AND checksum = '${checksum}'
  )
) AS checksum_ok \gset

\if :already_applied
  \if :checksum_ok
    \echo 'Skip migration: ${filename} (already applied with matching checksum)'
  \else
    \echo 'ERROR: checksum mismatch for already applied migration ${filename}'
    \echo '       existing=' :existing_checksum ' expected=${checksum}'
    \quit 1
  \endif
\else
\echo 'Apply migration: ${filename}'
SET lock_timeout = '${MIGRATION_LOCK_TIMEOUT}';
SET statement_timeout = '${MIGRATION_STATEMENT_TIMEOUT}';
\i ${file}
INSERT INTO schema_migrations (filename, version, checksum, applied_at)
VALUES ('${filename}', '${version}', '${checksum}', NOW())
ON CONFLICT (filename) DO NOTHING;
\endif
SQL
done
