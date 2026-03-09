#!/usr/bin/env bash
set -euo pipefail

RUN_MIGRATIONS="${RUN_MIGRATIONS:-false}"
CLOUDSQL_INSTANCE="${CLOUDSQL_INSTANCE:-}"
DB_USER="${DB_USER:-migration_user}"  # migration専用ユーザー。アプリ実行ユーザー(app_user)とは分離
DB_NAME="${DB_NAME:-reservation_system}"
DB_PASSWORD_SECRET="${DB_PASSWORD_SECRET:-db-password-migration}"  # migration専用 secret。runtime は db-password を使用
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

CLOUDSQL_CONNECTION_NAME="${CLOUDSQL_INSTANCE}"
if [[ "${CLOUDSQL_INSTANCE}" != *:*:* ]]; then
  CLOUDSQL_CONNECTION_NAME="$(gcloud sql instances describe "${CLOUDSQL_INSTANCE}" --format='value(connectionName)')"
fi

if [ -z "${CLOUDSQL_CONNECTION_NAME}" ]; then
  echo "ERROR: failed to resolve Cloud SQL connection name from CLOUDSQL_INSTANCE=${CLOUDSQL_INSTANCE}"
  exit 1
fi

CLOUD_SQL_PROXY_BIN="$(command -v cloud-sql-proxy || true)"
if [ -z "${CLOUD_SQL_PROXY_BIN}" ]; then
  SDK_ROOT="$(gcloud info --format='value(installation.sdk_root)' 2>/dev/null || true)"
  if [ -n "${SDK_ROOT}" ] && [ -x "${SDK_ROOT}/bin/cloud-sql-proxy" ]; then
    CLOUD_SQL_PROXY_BIN="${SDK_ROOT}/bin/cloud-sql-proxy"
  fi
fi

if [ -z "${CLOUD_SQL_PROXY_BIN}" ]; then
  echo "cloud-sql-proxy not found. Installing gcloud component..."
  gcloud components install cloud-sql-proxy --quiet
  hash -r
  CLOUD_SQL_PROXY_BIN="$(command -v cloud-sql-proxy || true)"
  if [ -z "${CLOUD_SQL_PROXY_BIN}" ]; then
    SDK_ROOT="$(gcloud info --format='value(installation.sdk_root)' 2>/dev/null || true)"
    if [ -n "${SDK_ROOT}" ] && [ -x "${SDK_ROOT}/bin/cloud-sql-proxy" ]; then
      CLOUD_SQL_PROXY_BIN="${SDK_ROOT}/bin/cloud-sql-proxy"
    fi
  fi
fi

if [ -z "${CLOUD_SQL_PROXY_BIN}" ]; then
  echo "ERROR: cloud-sql-proxy binary not found after installation"
  exit 1
fi

DB_PASSWORD="$(gcloud secrets versions access latest --secret="${DB_PASSWORD_SECRET}")"
export PGPASSWORD="${DB_PASSWORD}"

CLOUDSQL_PROXY_PORT="${CLOUDSQL_PROXY_PORT:-9470}"
proxy_log="$(mktemp)"
"${CLOUD_SQL_PROXY_BIN}" "${CLOUDSQL_CONNECTION_NAME}" --address 127.0.0.1 --port "${CLOUDSQL_PROXY_PORT}" >"${proxy_log}" 2>&1 &
proxy_pid=$!

cleanup_proxy() {
  if [ -n "${proxy_pid:-}" ] && kill -0 "${proxy_pid}" >/dev/null 2>&1; then
    kill "${proxy_pid}" >/dev/null 2>&1 || true
    wait "${proxy_pid}" 2>/dev/null || true
  fi
  rm -f "${proxy_log}" >/dev/null 2>&1 || true
}
trap cleanup_proxy EXIT

sleep 2
if ! kill -0 "${proxy_pid}" >/dev/null 2>&1; then
  echo "Cloud SQL Proxy failed to start"
  cat "${proxy_log}" || true
  exit 1
fi

for _ in $(seq 1 30); do
  if grep -q "ready for new connections" "${proxy_log}" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "${proxy_pid}" >/dev/null 2>&1; then
    echo "Cloud SQL Proxy exited before becoming ready"
    cat "${proxy_log}" || true
    exit 1
  fi
  sleep 1
done

if ! grep -q "ready for new connections" "${proxy_log}" >/dev/null 2>&1; then
  echo "Cloud SQL Proxy did not become ready in time"
  cat "${proxy_log}" || true
  exit 1
fi

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

  if ! cat <<SQL | psql \
    --host=127.0.0.1 \
    --port="${CLOUDSQL_PROXY_PORT}" \
    --username="${DB_USER}" \
    --dbname="${DB_NAME}" \
    --no-password
\set ON_ERROR_STOP on

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  version VARCHAR(64),
  checksum TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_version
  ON schema_migrations (version);

SELECT COALESCE(
  (SELECT checksum FROM schema_migrations WHERE filename = '${filename}'),
  ''
) AS existing_checksum \gset

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
  then
    echo "Migration execution failed for ${filename}"
    cat "${proxy_log}" || true
    exit 1
  fi
done
