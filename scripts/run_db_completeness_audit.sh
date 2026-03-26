#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-}"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/run_db_completeness_audit.sh fresh
  bash scripts/run_db_completeness_audit.sh live

Environment:
  Fresh mode:
    DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
    or CLOUDSQL_INSTANCE + DB_PASSWORD_SECRET for proxy-backed checks
    RUN_REQUEST_LOG_CHECK=true (optional, requires PROJECT_ID)

  Live mode:
    CLOUDSQL_INSTANCE
    DB_USER (default: migration_user)
    DB_PASSWORD_SECRET (default: db-password-migration)
    PROJECT_ID (required for Cloud Logging checks)
    API_URL or PROJECT_ID + REGION + API_SERVICE (default: reserve-api)
    FIREBASE_API_KEY (required for smoke)

Artifacts:
  scripts/out/db_completeness_audit/<mode>/<timestamp>/
USAGE
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $1" >&2
    exit 1
  fi
}

log() {
  printf '%s\n' "$*" | tee -a "${AUDIT_LOG}"
}

run_step() {
  local label="$1"
  local outfile="$2"
  shift 2

  log "== ${label} =="

  set +e
  "$@" >"${outfile}" 2>&1
  local status=$?
  set -e

  cat "${outfile}" | tee -a "${AUDIT_LOG}"
  printf '\n' | tee -a "${AUDIT_LOG}"

  return "${status}"
}

resolve_api_url() {
  if [ -n "${API_URL:-}" ]; then
    printf '%s\n' "${API_URL}"
    return
  fi

  require_command gcloud

  local project="${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
  local region="${REGION:-asia-northeast1}"
  local service="${API_SERVICE:-reserve-api}"

  if [ -z "${project}" ]; then
    echo "ERROR: PROJECT_ID is required to resolve API_URL" >&2
    exit 1
  fi

  gcloud run services describe "${service}" \
    --project "${project}" \
    --region "${region}" \
    --format='value(status.url)'
}

run_request_log_check() {
  local project="${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}"
  local window_minutes="${LOG_WINDOW_MINUTES:-60}"
  local api_service="${API_SERVICE:-reserve-api}"
  local services="${AUDIT_LOG_SERVICES:-${API_SERVICE:-reserve-api},reserve-admin,reserve-customer}"
  local summary_file="${ARTIFACT_DIR}/request-log-summary.txt"
  local request_json uuid_json service total five_xx uuid_hits error_rate status=0

  if [ -z "${project}" ]; then
    if [ "${audit_mode}" = "live" ] || [ "${RUN_REQUEST_LOG_CHECK:-false}" = "true" ]; then
      echo "ERROR: PROJECT_ID is required for request-log checks" >&2
      return 1
    fi
    echo "Skipping request-log check: PROJECT_ID is not set"
    return 0
  fi

  require_command gcloud
  require_command jq

  : >"${summary_file}"
  log "== request_log_check =="

  IFS=',' read -r -a service_list <<<"${services}"
  for service in "${service_list[@]}"; do
    [ -n "${service}" ] || continue

    request_json="${ARTIFACT_DIR}/${service}.requests.json"
    uuid_json="${ARTIFACT_DIR}/${service}.uuid-regressions.json"

    gcloud logging read \
      "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${service}\" AND logName=\"projects/${project}/logs/run.googleapis.com%2Frequests\"" \
      --project "${project}" \
      --freshness "${window_minutes}m" \
      --limit 5000 \
      --format=json >"${request_json}"

    gcloud logging read \
      "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${service}\" AND (textPayload:\"invalid input syntax for type uuid\" OR jsonPayload.message:\"invalid input syntax for type uuid\")" \
      --project "${project}" \
      --freshness "${window_minutes}m" \
      --limit 200 \
      --format=json >"${uuid_json}"

    total="$(jq 'length' "${request_json}")"
    five_xx="$(jq '[.[] | select((.httpRequest.status // 0) >= 500)] | length' "${request_json}")"
    uuid_hits="$(jq 'length' "${uuid_json}")"
    error_rate="$(awk -v five_xx="${five_xx}" -v total="${total}" 'BEGIN { if (total == 0) { printf "0.00"; } else { printf "%.2f", (five_xx * 100.0) / total; } }')"

    printf '%s total=%s five_xx=%s error_rate=%s%% uuid_hits=%s\n' "${service}" "${total}" "${five_xx}" "${error_rate}" "${uuid_hits}" >>"${summary_file}"

    if [ "${service}" = "${api_service}" ] && [ "${total}" -eq 0 ]; then
      echo "ERROR: no request logs found for ${service} within the freshness window" >&2
      status=1
    fi
    if [ "${service}" != "${api_service}" ] && [ "${total}" -eq 0 ]; then
      log "INFO: no request logs found for ${service} within the freshness window"
    fi
    if awk -v rate="${error_rate}" 'BEGIN { exit !(rate > 2.0) }'; then
      echo "ERROR: request-log 5xx rate for ${service} exceeds 2.0%" >&2
      status=1
    fi
    if [ "${uuid_hits}" -gt 0 ]; then
      echo "ERROR: UUID regression detected for ${service}" >&2
      status=1
    fi
  done

  cat "${summary_file}" | tee -a "${AUDIT_LOG}"
  printf '\n' | tee -a "${AUDIT_LOG}"

  return "${status}"
}

audit_mode="${MODE}"
case "${audit_mode}" in
  fresh|live)
    ;;
  ""|-h|--help|help)
    usage
    exit 0
    ;;
  *)
    echo "ERROR: unknown mode: ${audit_mode}" >&2
    usage >&2
    exit 1
    ;;
esac

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARTIFACT_ROOT="${AUDIT_ARTIFACT_ROOT:-${ROOT_DIR}/scripts/out/db_completeness_audit}"
ARTIFACT_DIR="${ARTIFACT_ROOT}/${audit_mode}/${TIMESTAMP}"
AUDIT_LOG="${ARTIFACT_DIR}/audit.log"
mkdir -p "${ARTIFACT_DIR}"
: >"${AUDIT_LOG}"

log "audit_mode=${audit_mode}"
log "artifact_dir=${ARTIFACT_DIR}"

require_command bash
require_command tee
require_command cat

DB_V3_COMMAND="status"
if [ "${audit_mode}" = "fresh" ]; then
  DB_V3_COMMAND="status-fresh"
fi

DB_STEP_OUT="${ARTIFACT_DIR}/db_v3.${DB_V3_COMMAND}.log"
if ! run_step "db_v3.${DB_V3_COMMAND}" "${DB_STEP_OUT}" env \
  CLOUDSQL_INSTANCE="${CLOUDSQL_INSTANCE:-}" \
  CLOUDSQL_PROXY_USE_GCLOUD_AUTH="${CLOUDSQL_PROXY_USE_GCLOUD_AUTH:-}" \
  CLOUD_SQL_PROXY_BIN="${CLOUD_SQL_PROXY_BIN:-}" \
  CLOUDSQL_PROXY_PORT="${CLOUDSQL_PROXY_PORT:-}" \
  DB_HOST="${DB_HOST:-127.0.0.1}" \
  DB_PORT="${DB_PORT:-5432}" \
  DB_NAME="${DB_NAME:-reservation_system}" \
  DB_USER="${DB_USER:-migration_user}" \
  DB_PASSWORD="${DB_PASSWORD:-}" \
  DB_PASSWORD_SECRET="${DB_PASSWORD_SECRET:-}" \
  bash "${ROOT_DIR}/scripts/db_v3.sh" "${DB_V3_COMMAND}"; then
  echo "ERROR: DB verification failed" >&2
  exit 1
fi

API_URL_VALUE=""
if [ "${audit_mode}" = "live" ] || [ -n "${API_URL:-}" ]; then
  API_URL_VALUE="$(resolve_api_url)"
fi

if [ "${audit_mode}" = "live" ] && [ -z "${FIREBASE_API_KEY:-}" ]; then
  echo "ERROR: FIREBASE_API_KEY is required in live mode" >&2
  exit 1
fi

if [ -n "${API_URL_VALUE}" ] && [ -n "${FIREBASE_API_KEY:-}" ]; then
  require_command curl
  require_command jq

  HEALTH_OUT="${ARTIFACT_DIR}/health.json"
  READY_OUT="${ARTIFACT_DIR}/ready.json"
  SMOKE_OUT="${ARTIFACT_DIR}/smoke_public_onboarding.log"

  if ! run_step "health" "${HEALTH_OUT}" curl -fsS "${API_URL_VALUE}/health"; then
    echo "ERROR: /health check failed" >&2
    exit 1
  fi

  if ! run_step "ready" "${READY_OUT}" curl -fsS "${API_URL_VALUE}/ready"; then
    echo "ERROR: /ready check failed" >&2
    exit 1
  fi

  if ! run_step "smoke_public_onboarding" "${SMOKE_OUT}" env \
    API_URL="${API_URL_VALUE}" \
    FIREBASE_API_KEY="${FIREBASE_API_KEY}" \
    RUN_RESERVATION_TEST="${RUN_RESERVATION_TEST:-true}" \
    bash "${ROOT_DIR}/scripts/smoke_public_onboarding.sh"; then
    echo "ERROR: smoke_public_onboarding.sh failed" >&2
    exit 1
  fi
else
  log "Skipping health/ready/smoke checks: API_URL and/or FIREBASE_API_KEY not available"
fi

if [ "${audit_mode}" = "live" ] || [ "${RUN_REQUEST_LOG_CHECK:-false}" = "true" ]; then
  if ! run_request_log_check; then
    echo "ERROR: request-log verification failed" >&2
    exit 1
  fi
else
  log "Skipping request-log check: not enabled for this run"
fi

log "audit_status=PASS"
log "artifacts=${ARTIFACT_DIR}"
