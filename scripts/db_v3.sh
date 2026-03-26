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

CANONICAL_PUBLIC_TABLES=(
    tenants
    tenant_google_calendar_oauth
    tenant_salonboard_config
    stores
    practitioners
    menus
    menu_options
    customers
    reservations
    reservation_menus
    reservation_options
    kartes
    karte_templates
    admins
    daily_analytics
    settings
    schema_migrations
    audit_logs
    service_message_logs
    google_calendar_sync_tasks
    booking_link_tokens
    practitioner_store_assignments
    menu_practitioner_assignments
    option_menu_assignments
    admin_store_assignments
    export_jobs
    tenant_rfm_settings
    tenant_notification_settings
)

LIVE_ONLY_ALLOWED_TABLES=(
    id_mappings
)

EXPECTED_FORCE_RLS_TABLES=(
    stores
    practitioners
    menus
    menu_options
    customers
    reservations
    reservation_menus
    reservation_options
    kartes
    karte_templates
    admins
    daily_analytics
    settings
    audit_logs
    service_message_logs
    tenant_google_calendar_oauth
    tenant_salonboard_config
    google_calendar_sync_tasks
    booking_link_tokens
    practitioner_store_assignments
    menu_practitioner_assignments
    option_menu_assignments
    admin_store_assignments
    export_jobs
    tenant_rfm_settings
    tenant_notification_settings
)

usage() {
    cat <<'USAGE'
Usage:
  bash scripts/db_v3.sh bootstrap-fresh
  ALLOW_DEV_SEED=true bash scripts/db_v3.sh seed-dev
  bash scripts/db_v3.sh status
  bash scripts/db_v3.sh status-fresh

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

psql_query() {
    local sql="$1"
    PGPASSWORD="${PGPASSWORD:-}" psql \
        --host="${DB_HOST}" \
        --port="${DB_PORT}" \
        --username="${DB_USER}" \
        --dbname="${DB_NAME}" \
        --no-password \
        --set=ON_ERROR_STOP=1 \
        --pset=pager=off \
        --tuples-only \
        --no-align \
        --field-separator='|' \
        --command "${sql}"
}

hash_file() {
    local file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "${file}" | awk '{print $1}'
        return
    fi
    shasum -a 256 "${file}" | awk '{print $1}'
}

check_schema_shape() {
    local title="${1:-schema_shape}"
    local missing_tables unexpected_tables allowed_extra_present actual_sorted actual_sorted_clean actual_count
    echo "== ${title} =="

    actual_sorted="$(psql_query "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name")"
    actual_sorted_clean="$(printf '%s\n' "${actual_sorted}" | sed '/^$/d')"
    if [ -n "${actual_sorted_clean}" ]; then
        actual_count="$(printf '%s\n' "${actual_sorted_clean}" | wc -l | tr -d '[:space:]')"
    else
        actual_count=0
    fi

    if [ -n "${actual_sorted_clean}" ]; then
        missing_tables="$(comm -23 <(printf '%s\n' "${CANONICAL_PUBLIC_TABLES[@]}" | sort) <(printf '%s\n' "${actual_sorted_clean}") || true)"
        unexpected_tables="$(comm -13 <(printf '%s\n' "${CANONICAL_PUBLIC_TABLES[@]}" | sort) <(printf '%s\n' "${actual_sorted_clean}") || true)"
    else
        missing_tables="$(printf '%s\n' "${CANONICAL_PUBLIC_TABLES[@]}" | sort)"
        unexpected_tables=""
    fi

    if [[ "${title}" == *"(live)"* ]]; then
        if [ -n "${unexpected_tables}" ]; then
            unexpected_tables="$(comm -23 <(printf '%s\n' "${unexpected_tables}" | sort -u) <(printf '%s\n' "${LIVE_ONLY_ALLOWED_TABLES[@]}" | sort) || true)"
        fi
        if [ -n "${actual_sorted_clean}" ]; then
            allowed_extra_present="$(comm -12 <(printf '%s\n' "${LIVE_ONLY_ALLOWED_TABLES[@]}" | sort) <(printf '%s\n' "${actual_sorted_clean}") || true)"
        else
            allowed_extra_present=""
        fi
    else
        allowed_extra_present=""
    fi

    printf 'expected_tables=%s actual_tables=%s\n' "${#CANONICAL_PUBLIC_TABLES[@]}" "${actual_count}"
    if [ -n "${missing_tables}" ]; then
        echo 'missing_tables:'
        printf '%s\n' "${missing_tables}"
    else
        echo 'missing_tables: (none)'
    fi
    if [ -n "${unexpected_tables}" ]; then
        echo 'unexpected_tables:'
        printf '%s\n' "${unexpected_tables}"
    else
        echo 'unexpected_tables: (none)'
    fi

    if [ -n "${allowed_extra_present}" ]; then
        echo 'allowed_upgrade_only_tables:'
        printf '%s\n' "${allowed_extra_present}"
    fi

    if [ -n "${missing_tables}" ] || [ -n "${unexpected_tables}" ]; then
        return 1
    fi
}

check_legacy_columns() {
    local rows
    echo '== legacy_columns =='
    rows="$(psql_query "SELECT format('%s.%s', table_name, column_name) AS legacy_column FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'reservations' AND column_name IN ('period', 'date', 'start_time', 'end_time')) OR (table_name = 'practitioners' AND column_name = 'store_ids') OR (table_name = 'menus' AND column_name = 'practitioner_ids') OR (table_name = 'menu_options' AND column_name = 'applicable_menu_ids') OR (table_name = 'admins' AND column_name = 'store_ids')) ORDER BY table_name, column_name")"
    if [ -n "${rows}" ]; then
        printf '%s\n' "${rows}"
        return 1
    fi
    echo '(none)'
}

check_helper_functions() {
    local rows row routine_name present security_definer app_user_execute ok=0
    echo '== helper_functions =='
    rows="$(psql_query "WITH expected(routine_name) AS (VALUES ('resolve_active_store_context'), ('resolve_booking_link_token')) SELECT e.routine_name, CASE WHEN p.oid IS NOT NULL THEN 't' ELSE 'f' END AS present, CASE WHEN p.prosecdef THEN 't' ELSE 'f' END AS security_definer, CASE WHEN EXISTS (SELECT 1 FROM information_schema.role_routine_grants g WHERE g.routine_schema = 'public' AND g.routine_name = e.routine_name AND g.grantee = 'app_user' AND g.privilege_type = 'EXECUTE') THEN 't' ELSE 'f' END AS app_user_execute FROM expected e LEFT JOIN pg_proc p ON p.proname = e.routine_name AND p.pronamespace = 'public'::regnamespace ORDER BY e.routine_name")"
    if [ -z "${rows}" ]; then
        echo '(missing)'
        return 1
    fi

    while IFS='|' read -r routine_name present security_definer app_user_execute; do
        [ -n "${routine_name}" ] || continue
        printf '%s|%s|%s|%s\n' "${routine_name}" "${present}" "${security_definer}" "${app_user_execute}"
        if [ "${present}" != "t" ] || [ "${security_definer}" != "t" ] || [ "${app_user_execute}" != "t" ]; then
            ok=1
        fi
    done <<EOF
${rows}
EOF
    return "${ok}"
}

check_force_rls() {
    local rows row table_name rls_enabled force_rls ok=0
    echo '== force_rls =='
    rows="$(psql_query "WITH expected(table_name) AS (VALUES ('stores'), ('practitioners'), ('menus'), ('menu_options'), ('customers'), ('reservations'), ('reservation_menus'), ('reservation_options'), ('kartes'), ('karte_templates'), ('admins'), ('daily_analytics'), ('settings'), ('audit_logs'), ('service_message_logs'), ('tenant_google_calendar_oauth'), ('tenant_salonboard_config'), ('google_calendar_sync_tasks'), ('booking_link_tokens'), ('practitioner_store_assignments'), ('menu_practitioner_assignments'), ('option_menu_assignments'), ('admin_store_assignments'), ('export_jobs'), ('tenant_rfm_settings'), ('tenant_notification_settings')) SELECT e.table_name, CASE WHEN c.relrowsecurity THEN 't' ELSE 'f' END AS rls_enabled, CASE WHEN c.relforcerowsecurity THEN 't' ELSE 'f' END AS force_rls FROM expected e LEFT JOIN pg_class c ON c.relname = e.table_name AND c.relkind = 'r' LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' ORDER BY e.table_name")"
    if [ -z "${rows}" ]; then
        echo '(missing)'
        return 1
    fi

    while IFS='|' read -r table_name rls_enabled force_rls; do
        [ -n "${table_name}" ] || continue
        printf '%s|%s|%s\n' "${table_name}" "${rls_enabled}" "${force_rls}"
        if [ "${rls_enabled}" != "t" ] || [ "${force_rls}" != "t" ]; then
            ok=1
        fi
    done <<EOF
${rows}
EOF
    return "${ok}"
}

check_app_user_role() {
    local row rolname rolbypassrls
    echo '== app_user_role =='
    row="$(psql_query "SELECT 'rolname=' || rolname || ' rolbypassrls=' || CASE WHEN rolbypassrls THEN 't' ELSE 'f' END FROM pg_roles WHERE rolname = 'app_user'")"
    if [ -z "${row}" ]; then
        echo '(missing)'
        return 1
    fi
    printf '%s\n' "${row}"
    [[ "${row}" == *"rolbypassrls=f"* ]]
}

check_schema_migrations_fresh() {
    local row
    echo '== schema_migrations =='
    row="$(psql_query "SELECT 'latest_filename=' || COALESCE((SELECT filename FROM schema_migrations ORDER BY applied_at DESC, filename DESC LIMIT 1), '(empty)') || ' applied_count=' || COALESCE((SELECT COUNT(*)::text FROM schema_migrations), '0')")"
    if [ -z "${row}" ]; then
        echo '(missing)'
        return 1
    fi
    printf '%s\n' "${row}"
}

check_schema_migrations_live() {
    local latest_row missing_repo_migrations checksum_mismatches unexpected_db_migrations ok=0
    echo '== schema_migrations =='
    latest_row="$(psql_query "SELECT 'latest_filename=' || COALESCE((SELECT filename FROM schema_migrations ORDER BY applied_at DESC, filename DESC LIMIT 1), '(empty)') || ' applied_count=' || COALESCE((SELECT COUNT(*)::text FROM schema_migrations), '0')")"
    printf '%s\n' "${latest_row}"

    missing_repo_migrations=()
    checksum_mismatches=()
    unexpected_db_migrations=()

    local repo_tmp db_tmp filename repo_version repo_checksum db_version db_checksum
    repo_tmp="$(mktemp)"
    db_tmp="$(mktemp)"

    while IFS= read -r filename; do
        [ -n "${filename}" ] || continue
        repo_version="${filename%%_*}"
        repo_version="${repo_version%.sql}"
        repo_checksum="$(hash_file "${ROOT_DIR}/database/migrations/${filename}")"
        printf '%s|%s|%s\n' "${filename}" "${repo_version}" "${repo_checksum}" >>"${repo_tmp}"
    done < <(find "${ROOT_DIR}/database/migrations" -maxdepth 1 -type f -name '*.sql' -exec basename {} \; | sort)

    psql_query "SELECT filename, version, COALESCE(checksum, '') FROM schema_migrations ORDER BY filename" >"${db_tmp}"

    while IFS='|' read -r filename repo_version repo_checksum db_version db_checksum; do
        [ -n "${filename}" ] || continue
        if [ "${db_checksum}" != "${repo_checksum}" ]; then
            checksum_mismatches+=("${filename}|db_version=${db_version:-missing}|db_checksum=${db_checksum}|repo_version=${repo_version}|repo_checksum=${repo_checksum}")
            ok=1
            continue
        fi

        # Historical rows may predate version backfill; checksum parity is the authoritative guard.
        if [ -n "${db_version}" ] && [ "${db_version}" != "${repo_version}" ]; then
            checksum_mismatches+=("${filename}|db_version=${db_version:-missing}|db_checksum=${db_checksum}|repo_version=${repo_version}|repo_checksum=${repo_checksum}")
            ok=1
        fi
    done < <(join -t '|' -1 1 -2 1 <(sort "${repo_tmp}") <(sort "${db_tmp}") || true)

    while IFS='|' read -r filename repo_version repo_checksum; do
        [ -n "${filename}" ] || continue
        if ! awk -F '|' -v target="${filename}" '$1 == target { found = 1 } END { exit(found ? 0 : 1) }' "${db_tmp}"; then
            missing_repo_migrations+=("${filename}")
            ok=1
        fi
    done <"${repo_tmp}"

    while IFS='|' read -r filename db_version db_checksum; do
        [ -n "${filename}" ] || continue
        if ! awk -F '|' -v target="${filename}" '$1 == target { found = 1 } END { exit(found ? 0 : 1) }' "${repo_tmp}"; then
            unexpected_db_migrations+=("${filename}|version=${db_version}|checksum=${db_checksum}")
            ok=1
        fi
    done <"${db_tmp}"

    echo '== missing_repo_migrations =='
    if [ "${#missing_repo_migrations[@]}" -gt 0 ]; then
        printf '%s\n' "${missing_repo_migrations[@]}"
    else
        echo '(none)'
    fi

    echo '== checksum_mismatches =='
    if [ "${#checksum_mismatches[@]}" -gt 0 ]; then
        printf '%s\n' "${checksum_mismatches[@]}"
    else
        echo '(none)'
    fi

    echo '== unexpected_db_migrations =='
    if [ "${#unexpected_db_migrations[@]}" -gt 0 ]; then
        printf '%s\n' "${unexpected_db_migrations[@]}"
    else
        echo '(none)'
    fi

    rm -f "${repo_tmp}" "${db_tmp}" >/dev/null 2>&1 || true

    return "${ok}"
}

run_status_fresh() {
    local status=0
    check_schema_shape "schema_shape (fresh)" || status=1
    check_schema_migrations_fresh || status=1
    check_legacy_columns || status=1
    check_helper_functions || status=1
    check_force_rls || status=1
    check_app_user_role || status=1
    return "${status}"
}

run_status_live() {
    local status=0
    check_schema_shape "schema_shape (live)" || status=1
    check_schema_migrations_live || status=1
    check_legacy_columns || status=1
    check_helper_functions || status=1
    check_force_rls || status=1
    check_app_user_role || status=1
    return "${status}"
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
        bootstrap-fresh|seed-dev|status|status-fresh)
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
            run_status_live
            ;;
        status-fresh)
            run_status_fresh
            ;;
    esac
}

main "$@"
