#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ENV="${1:-}"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/run_feature_verification.sh dev-v3
  bash scripts/run_feature_verification.sh live

Environment:
  FIREBASE_API_KEY              Required for public onboarding smoke
  PROJECT_ID                    Default: keyexpress-reserve
  REGION                        Default: asia-northeast1
  API_URL / CUSTOMER_URL        Optional explicit URLs
  API_SERVICE / CUSTOMER_SERVICE
                                Optional Cloud Run service names for URL resolution
  LOG_SERVICE                   Optional Cloud Run service name for manual helper output
  AUDIT_LOG_SERVICES            Optional comma-separated request-log services
  RUN_RESERVATION_TEST          Default: true

Artifacts:
  scripts/out/feature_verification/<env>/<timestamp>/
USAGE
}

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "ERROR: required command not found: ${cmd}" >&2
    exit 1
  fi
}

log() {
  printf '%s\n' "$*" | tee -a "${RUN_LOG}"
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

  cat "${outfile}" | tee -a "${RUN_LOG}"
  printf '\n' | tee -a "${RUN_LOG}"

  return "${status}"
}

resolve_service_url() {
  local service="$1"
  require_command gcloud
  gcloud run services describe "${service}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --format='value(status.url)'
}

run_request_log_check() {
  local services="${AUDIT_LOG_SERVICES}"
  local freshness_minutes="${LOG_WINDOW_MINUTES:-60}"
  local summary_file="${ARTIFACT_DIR}/request-log-summary.txt"
  local request_json uuid_json service total five_xx uuid_hits error_rate status=0

  if [ -z "${PROJECT_ID}" ]; then
    echo "ERROR: PROJECT_ID is required for request-log verification" >&2
    return 1
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
      "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${service}\" AND logName=\"projects/${PROJECT_ID}/logs/run.googleapis.com%2Frequests\"" \
      --project "${PROJECT_ID}" \
      --freshness "${freshness_minutes}m" \
      --limit 5000 \
      --format=json >"${request_json}"

    gcloud logging read \
      "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${service}\" AND (textPayload:\"invalid input syntax for type uuid\" OR jsonPayload.message:\"invalid input syntax for type uuid\")" \
      --project "${PROJECT_ID}" \
      --freshness "${freshness_minutes}m" \
      --limit 200 \
      --format=json >"${uuid_json}"

    total="$(jq 'length' "${request_json}")"
    five_xx="$(jq '[.[] | select((.httpRequest.status // 0) >= 500)] | length' "${request_json}")"
    uuid_hits="$(jq 'length' "${uuid_json}")"
    error_rate="$(awk -v five_xx="${five_xx}" -v total="${total}" 'BEGIN { if (total == 0) { printf "0.00"; } else { printf "%.2f", (five_xx * 100.0) / total; } }')"

    printf '%s total=%s five_xx=%s error_rate=%s%% uuid_hits=%s\n' "${service}" "${total}" "${five_xx}" "${error_rate}" "${uuid_hits}" >>"${summary_file}"

    if [ "${service}" = "${API_SERVICE}" ] && [ "${total}" -eq 0 ]; then
      echo "ERROR: no request logs found for ${service} within the freshness window" >&2
      status=1
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

  cat "${summary_file}" | tee -a "${RUN_LOG}"
  printf '\n' | tee -a "${RUN_LOG}"
  return "${status}"
}

case "${TARGET_ENV}" in
  dev-v3|live)
    ;;
  ""|-h|--help|help)
    usage
    exit 0
    ;;
  *)
    echo "ERROR: unknown environment '${TARGET_ENV}'" >&2
    usage >&2
    exit 1
    ;;
esac

PROJECT_ID="${PROJECT_ID:-keyexpress-reserve}"
REGION="${REGION:-asia-northeast1}"
RUN_RESERVATION_TEST="${RUN_RESERVATION_TEST:-true}"

case "${TARGET_ENV}" in
  dev-v3)
    API_SERVICE="${API_SERVICE:-reserve-api-dev-v3}"
    CUSTOMER_SERVICE="${CUSTOMER_SERVICE:-reserve-customer-dev-v3}"
    LOG_SERVICE="${LOG_SERVICE:-reserve-api-dev-v3}"
    API_URL="${API_URL:-https://reserve-api-dev-v3-czjwiprc2q-an.a.run.app}"
    CUSTOMER_URL="${CUSTOMER_URL:-https://reserve-customer-dev-v3-czjwiprc2q-an.a.run.app}"
    AUDIT_LOG_SERVICES="${AUDIT_LOG_SERVICES:-${API_SERVICE},${CUSTOMER_SERVICE}}"
    ;;
  live)
    API_SERVICE="${API_SERVICE:-reserve-api}"
    CUSTOMER_SERVICE="${CUSTOMER_SERVICE:-reserve-customer}"
    LOG_SERVICE="${LOG_SERVICE:-reserve-api}"
    API_URL="${API_URL:-}"
    CUSTOMER_URL="${CUSTOMER_URL:-}"
    AUDIT_LOG_SERVICES="${AUDIT_LOG_SERVICES:-${API_SERVICE},reserve-admin,${CUSTOMER_SERVICE}}"
    ;;
esac

if [ -z "${FIREBASE_API_KEY:-}" ]; then
  echo "ERROR: FIREBASE_API_KEY is required" >&2
  exit 1
fi

require_command bash
require_command curl
require_command jq
require_command tee
require_command cat

if [ -z "${API_URL}" ]; then
  API_URL="$(resolve_service_url "${API_SERVICE}")"
fi
if [ -z "${CUSTOMER_URL}" ] && [ -n "${CUSTOMER_SERVICE}" ]; then
  CUSTOMER_URL="$(resolve_service_url "${CUSTOMER_SERVICE}")"
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARTIFACT_ROOT="${FEATURE_ARTIFACT_ROOT:-${ROOT_DIR}/scripts/out/feature_verification}"
ARTIFACT_DIR="${ARTIFACT_ROOT}/${TARGET_ENV}/${TIMESTAMP}"
RUN_LOG="${ARTIFACT_DIR}/run.log"
mkdir -p "${ARTIFACT_DIR}"
: >"${RUN_LOG}"

PUBLIC_JSON="${ARTIFACT_DIR}/public_onboarding.json"
PUBLIC_LOG="${ARTIFACT_DIR}/public_onboarding.log"
ADMIN_JSON="${ARTIFACT_DIR}/admin_capabilities.json"
ADMIN_LOG="${ARTIFACT_DIR}/admin_capabilities.log"
HEALTH_OUT="${ARTIFACT_DIR}/health.json"
READY_OUT="${ARTIFACT_DIR}/ready.json"
MANUAL_FINDINGS="${ARTIFACT_DIR}/real_line_findings.${TARGET_ENV}.md"
MANUAL_PREP_LOG="${ARTIFACT_DIR}/prepare_real_line_e2e.log"

log "target_env=${TARGET_ENV}"
log "artifact_dir=${ARTIFACT_DIR}"
log "api_url=${API_URL}"
log "customer_url=${CUSTOMER_URL}"

if ! run_step "health" "${HEALTH_OUT}" curl -fsS "${API_URL}/health"; then
  echo "ERROR: /health check failed" >&2
  exit 1
fi

if ! run_step "ready" "${READY_OUT}" curl -fsS "${API_URL}/ready"; then
  echo "ERROR: /ready check failed" >&2
  exit 1
fi

if ! run_step "smoke_public_onboarding" "${PUBLIC_LOG}" env \
  API_URL="${API_URL}" \
  CUSTOMER_URL="${CUSTOMER_URL}" \
  FIREBASE_API_KEY="${FIREBASE_API_KEY}" \
  RUN_RESERVATION_TEST="${RUN_RESERVATION_TEST}" \
  OUTPUT_JSON="${PUBLIC_JSON}" \
  bash "${ROOT_DIR}/scripts/smoke_public_onboarding.sh"; then
  echo "ERROR: smoke_public_onboarding.sh failed" >&2
  exit 1
fi

if ! run_step "smoke_admin_capabilities" "${ADMIN_LOG}" env \
  INPUT_JSON="${PUBLIC_JSON}" \
  OUTPUT_JSON="${ADMIN_JSON}" \
  API_URL="${API_URL}" \
  bash "${ROOT_DIR}/scripts/smoke_admin_capabilities.sh"; then
  echo "ERROR: smoke_admin_capabilities.sh failed" >&2
  exit 1
fi

if ! run_step "prepare_real_line_e2e" "${MANUAL_PREP_LOG}" env \
  PROJECT_ID="${PROJECT_ID}" \
  REGION="${REGION}" \
  API_URL="${API_URL}" \
  CUSTOMER_URL="${CUSTOMER_URL}" \
  LOG_SERVICE="${LOG_SERVICE}" \
  INPUT_JSON="${PUBLIC_JSON}" \
  OUTPUT_PATH="${MANUAL_FINDINGS}" \
  bash "${ROOT_DIR}/scripts/prepare_real_line_e2e.sh" "${TARGET_ENV}"; then
  echo "ERROR: prepare_real_line_e2e.sh failed" >&2
  exit 1
fi

if ! run_request_log_check; then
  echo "ERROR: request-log verification failed" >&2
  exit 1
fi

log "feature_verification_status=PASS"
log "public_artifact=${PUBLIC_JSON}"
log "admin_artifact=${ADMIN_JSON}"
log "manual_findings=${MANUAL_FINDINGS}"
