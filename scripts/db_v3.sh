#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA_FILE="${ROOT_DIR}/database/schema/001_initial_schema.sql"
SEED_FILE="${ROOT_DIR}/database/seeds/001_dev_seed.sql"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-reservation_system}"
DB_USER="${DB_USER:-migration_user}"
DB_PASSWORD="${DB_PASSWORD:-${PGPASSWORD:-}}"
DB_PASSWORD_SECRET="${DB_PASSWORD_SECRET:-}"
PROJECT_ID="${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"

CLOUDSQL_INSTANCE="${CLOUDSQL_INSTANCE:-}"
CLOUDSQL_PROXY_PORT="${CLOUDSQL_PROXY_PORT:-9470}"
CLOUDSQL_PROXY_USE_GCLOUD_AUTH="${CLOUDSQL_PROXY_USE_GCLOUD_AUTH:-false}"
CLOUD_SQL_PROXY_BIN="${CLOUD_SQL_PROXY_BIN:-}"

proxy_pid=""
proxy_log=""

usage() {
    cat <<'USAGE'
Usage:
  bash scripts/db_v3.sh bootstrap-fresh
  ALLOW_DEV_SEED=true bash scripts/db_v3.sh seed-dev
  bash scripts/db_v3.sh status

Connection env vars:
  DB_HOST                  default: 127.0.0.1
  DB_PORT                  default: 5432
  DB_NAME                  default: reservation_system
  DB_USER                  default: migration_user
  DB_PASSWORD / PGPASSWORD optional
  DB_PASSWORD_SECRET       optional gcloud Secret Manager secret name

Optional Cloud SQL Proxy env vars:
  CLOUDSQL_INSTANCE                instance id or full connection name
  CLOUDSQL_PROXY_PORT              default: 9470
  CLOUDSQL_PROXY_USE_GCLOUD_AUTH   true -> start proxy with --gcloud-auth

Notes:
  - When CLOUDSQL_INSTANCE is set, this script starts cloud-sql-proxy automatically.
  - `seed-dev` refuses to run unless ALLOW_DEV_SEED=true.
USAGE
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "ERROR: required command not found: $1" >&2
        exit 1
    fi
}

load_db_password() {
    if [ -n "${DB_PASSWORD}" ]; then
        export PGPASSWORD="${DB_PASSWORD}"
        return
    fi

    if [ -n "${DB_PASSWORD_SECRET}" ]; then
        require_command gcloud
        export PGPASSWORD
        if [ -n "${PROJECT_ID}" ]; then
            PGPASSWORD="$(gcloud secrets versions access latest --project="${PROJECT_ID}" --secret="${DB_PASSWORD_SECRET}")"
        else
            PGPASSWORD="$(gcloud secrets versions access latest --secret="${DB_PASSWORD_SECRET}")"
        fi
    fi
}

resolve_proxy_bin() {
    if [ -n "${CLOUD_SQL_PROXY_BIN}" ] && [ -x "${CLOUD_SQL_PROXY_BIN}" ]; then
        return
    fi

    CLOUD_SQL_PROXY_BIN="$(command -v cloud-sql-proxy || true)"
    if [ -n "${CLOUD_SQL_PROXY_BIN}" ]; then
        return
    fi

    require_command gcloud
    local sdk_root
    sdk_root="$(gcloud info --format='value(installation.sdk_root)' 2>/dev/null || true)"
    if [ -n "${sdk_root}" ] && [ -x "${sdk_root}/bin/cloud-sql-proxy" ]; then
        CLOUD_SQL_PROXY_BIN="${sdk_root}/bin/cloud-sql-proxy"
        return
    fi

    echo "ERROR: cloud-sql-proxy not found. Install it or set CLOUD_SQL_PROXY_BIN." >&2
    exit 1
}

start_proxy_if_needed() {
    if [ -z "${CLOUDSQL_INSTANCE}" ]; then
        return
    fi

    require_command gcloud
    resolve_proxy_bin

    local connection_name="${CLOUDSQL_INSTANCE}"
    if [[ "${connection_name}" != *:*:* ]]; then
        if [ -n "${PROJECT_ID}" ]; then
            connection_name="$(gcloud sql instances describe "${CLOUDSQL_INSTANCE}" --project="${PROJECT_ID}" --format='value(connectionName)')"
        else
            connection_name="$(gcloud sql instances describe "${CLOUDSQL_INSTANCE}" --format='value(connectionName)')"
        fi
    fi

    if [ -z "${connection_name}" ]; then
        echo "ERROR: failed to resolve Cloud SQL connection name from CLOUDSQL_INSTANCE=${CLOUDSQL_INSTANCE}" >&2
        exit 1
    fi

    local proxy_args=("${connection_name}" "--address" "127.0.0.1" "--port" "${CLOUDSQL_PROXY_PORT}")
    if [ "${CLOUDSQL_PROXY_USE_GCLOUD_AUTH}" = "true" ]; then
        proxy_args+=("--gcloud-auth")
    fi

    proxy_log="$(mktemp)"
    "${CLOUD_SQL_PROXY_BIN}" "${proxy_args[@]}" >"${proxy_log}" 2>&1 &
    proxy_pid="$!"

    for _ in $(seq 1 30); do
        if grep -q "ready for new connections" "${proxy_log}" >/dev/null 2>&1; then
            DB_HOST="127.0.0.1"
            DB_PORT="${CLOUDSQL_PROXY_PORT}"
            return
        fi
        if ! kill -0 "${proxy_pid}" >/dev/null 2>&1; then
            break
        fi
        sleep 1
    done

    echo "ERROR: cloud-sql-proxy failed to become ready." >&2
    cat "${proxy_log}" >&2 || true
    exit 1
}

cleanup() {
    if [ -n "${proxy_pid}" ] && kill -0 "${proxy_pid}" >/dev/null 2>&1; then
        kill "${proxy_pid}" >/dev/null 2>&1 || true
        wait "${proxy_pid}" 2>/dev/null || true
    fi
    if [ -n "${proxy_log}" ]; then
        rm -f "${proxy_log}" >/dev/null 2>&1 || true
    fi
}

run_psql_file() {
    local sql_file="$1"
    PGPASSWORD="${PGPASSWORD:-}" psql \
        --host="${DB_HOST}" \
        --port="${DB_PORT}" \
        --username="${DB_USER}" \
        --dbname="${DB_NAME}" \
        --no-password \
        --set=ON_ERROR_STOP=1 \
        --file="${sql_file}"
}

run_status() {
    PGPASSWORD="${PGPASSWORD:-}" psql \
        --host="${DB_HOST}" \
        --port="${DB_PORT}" \
        --username="${DB_USER}" \
        --dbname="${DB_NAME}" \
        --no-password \
        --set=ON_ERROR_STOP=1 \
        --pset=pager=off <<'SQL'
\echo '== schema_migrations =='
SELECT (to_regclass('public.schema_migrations') IS NOT NULL) AS has_schema_migrations \gset
\if :has_schema_migrations
SELECT
    COALESCE(
        (SELECT filename
         FROM schema_migrations
         ORDER BY applied_at DESC, filename DESC
         LIMIT 1),
        '(empty)'
    ) AS latest_filename,
    COUNT(*) AS applied_count
FROM schema_migrations;
\else
SELECT '(missing)' AS latest_filename, 'n/a' AS applied_count;
\endif

\echo ''
\echo '== legacy_columns =='
SELECT
    COALESCE(
        string_agg(format('%s.%s', table_name, column_name), ', ' ORDER BY table_name, column_name),
        '(none)'
    ) AS legacy_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
      (table_name = 'reservations' AND column_name IN ('period', 'date', 'start_time', 'end_time'))
      OR (table_name = 'practitioners' AND column_name = 'store_ids')
      OR (table_name = 'menus' AND column_name = 'practitioner_ids')
      OR (table_name = 'menu_options' AND column_name = 'applicable_menu_ids')
      OR (table_name = 'admins' AND column_name = 'store_ids')
  );

\echo ''
\echo '== archetype_counts =='
WITH tenant_scope AS (
    SELECT id, slug
    FROM tenants
    WHERE slug IN ('demo-salon', 'chain-salon', 'onboarding-salon')
)
SELECT
    t.slug,
    (SELECT COUNT(*) FROM stores s WHERE s.tenant_id = t.id) AS stores,
    (SELECT COUNT(*) FROM practitioners p WHERE p.tenant_id = t.id) AS practitioners,
    (SELECT COUNT(*) FROM practitioner_store_assignments psa WHERE psa.tenant_id = t.id) AS practitioner_store_assignments,
    (SELECT COUNT(*) FROM menus m WHERE m.tenant_id = t.id) AS menus,
    (SELECT COUNT(*) FROM menu_practitioner_assignments mpa WHERE mpa.tenant_id = t.id) AS menu_practitioner_assignments,
    (SELECT COUNT(*) FROM menu_options mo WHERE mo.tenant_id = t.id) AS menu_options,
    (SELECT COUNT(*) FROM option_menu_assignments oma WHERE oma.tenant_id = t.id) AS option_menu_assignments,
    (SELECT COUNT(*) FROM customers c WHERE c.tenant_id = t.id) AS customers,
    (SELECT COUNT(*) FROM reservations r WHERE r.tenant_id = t.id) AS reservations,
    (SELECT COUNT(*) FROM reservation_menus rm WHERE rm.tenant_id = t.id) AS reservation_menus,
    (SELECT COUNT(*) FROM reservation_options ro WHERE ro.tenant_id = t.id) AS reservation_options,
    (SELECT COUNT(*) FROM admins a WHERE a.tenant_id = t.id) AS admins,
    (SELECT COUNT(*) FROM admin_store_assignments asa WHERE asa.tenant_id = t.id) AS admin_store_assignments,
    (SELECT COUNT(*) FROM settings st WHERE st.tenant_id = t.id) AS settings,
    (SELECT COUNT(*) FROM booking_link_tokens blt WHERE blt.tenant_id = t.id) AS booking_link_tokens,
    (SELECT COUNT(*) FROM tenant_rfm_settings trs WHERE trs.tenant_id = t.id) AS tenant_rfm_settings,
    (SELECT COUNT(*) FROM tenant_notification_settings tns WHERE tns.tenant_id = t.id) AS tenant_notification_settings
FROM tenant_scope t
ORDER BY CASE t.slug
    WHEN 'demo-salon' THEN 1
    WHEN 'chain-salon' THEN 2
    WHEN 'onboarding-salon' THEN 3
    ELSE 99
END;
SQL
}

bootstrap_fresh() {
    echo "Applying fresh schema: ${SCHEMA_FILE}"
    run_psql_file "${SCHEMA_FILE}"
}

seed_dev() {
    if [ "${ALLOW_DEV_SEED:-false}" != "true" ]; then
        echo "ERROR: seed-dev requires ALLOW_DEV_SEED=true" >&2
        exit 1
    fi

    echo "Applying dev seed: ${SEED_FILE}"
    run_psql_file "${SEED_FILE}"
}

main() {
    local command="${1:-}"
    case "${command}" in
        bootstrap-fresh|seed-dev|status)
            ;;
        ""|-h|--help|help)
            usage
            exit 0
            ;;
        *)
            echo "ERROR: unknown command: ${command}" >&2
            usage >&2
            exit 1
            ;;
    esac

    require_command psql
    load_db_password
    trap cleanup EXIT
    start_proxy_if_needed

    case "${command}" in
        bootstrap-fresh)
            bootstrap_fresh
            ;;
        seed-dev)
            seed_dev
            ;;
        status)
            run_status
            ;;
    esac
}

main "$@"
