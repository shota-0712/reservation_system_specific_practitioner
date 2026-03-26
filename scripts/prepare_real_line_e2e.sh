#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_ENV="${1:-dev-v3}"

tmp_files=()
cleanup() {
  local file=""
  for file in "${tmp_files[@]:-}"; do
    if [ -n "${file}" ] && [ -f "${file}" ]; then
      rm -f "${file}"
    fi
  done
  return 0
}
trap cleanup EXIT

usage() {
  cat <<'USAGE'
Prepare the real LINE smoke workbook and verify that manual preflight is runnable.

Usage:
  ./scripts/prepare_real_line_e2e.sh dev-v3
  ./scripts/prepare_real_line_e2e.sh live

Optional env vars:
  INPUT_JSON       Smoke artifact from scripts/smoke_public_onboarding.sh
                   dev-v3 fallback: latest local scripts/out/feature_verification/dev-v3/*/public_onboarding.json
  PROJECT_ID       Default: keyexpress-reserve
  REGION           Default: asia-northeast1
  API_SERVICE      Cloud Run API service name (default depends on env)
  CUSTOMER_SERVICE Cloud Run customer service name (default depends on env)
  API_URL          Explicit API URL override
  CUSTOMER_URL     Explicit customer URL override
  ROOT_URL         Default: CUSTOMER_URL/
  BOOKING_TOKEN    Required via env, INPUT_JSON, or fresh dev-v3 artifact
  BOOKING_TOKEN_URL
                   Default: CUSTOMER_URL/?t=BOOKING_TOKEN
  TENANT_KEY       Required via env, INPUT_JSON, or fresh dev-v3 artifact
  LOG_SERVICE      Default depends on env
  TEMPLATE_PATH    Default: docs/runbooks/reserve-v3-findings.template.md
  OUTPUT_PATH      Default: /tmp/reserve-v3-findings.<env>.md
USAGE
}

if [ "${TARGET_ENV}" = "--help" ] || [ "${TARGET_ENV}" = "-h" ] || [ "${TARGET_ENV}" = "help" ]; then
  usage
  exit 0
fi

case "${TARGET_ENV}" in
  dev-v3|live)
    ;;
  *)
    echo "ERROR: unknown environment '${TARGET_ENV}'" >&2
    usage >&2
    exit 1
    ;;
esac

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "ERROR: '${cmd}' command is required." >&2
    exit 1
  fi
}

read_json_field() {
  local key="$1"
  local file="$2"
  jq -r --arg key "${key}" '.[$key] // empty' "${file}"
}

resolve_service_url() {
  local service="$1"
  require_command gcloud
  gcloud run services describe "${service}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --format='value(status.url)'
}

latest_public_onboarding_json() {
  local target_env="$1"
  find "${REPO_ROOT}/scripts/out/feature_verification/${target_env}" \
    -mindepth 2 \
    -maxdepth 2 \
    -type f \
    -name public_onboarding.json \
    2>/dev/null | sort | tail -n 1
}

compact_response_body() {
  local body_file="$1"
  python3 - "${body_file}" <<'PY'
from pathlib import Path
import re
import sys

content = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
content = re.sub(r"\s+", " ", content).strip()
print(content[:240])
PY
}

api_get_json() {
  local url="$1"
  local response_file
  response_file="$(mktemp)"
  tmp_files+=("${response_file}")

  local status=""
  local curl_exit=0
  set +e
  status="$(curl \
    --silent \
    --show-error \
    --output "${response_file}" \
    --write-out "%{http_code}" \
    --request GET \
    "${url}")"
  curl_exit=$?
  set -e

  if [ "${curl_exit}" -ne 0 ]; then
    echo "ERROR: curl transport failed for GET ${url} (exit=${curl_exit})" >&2
    if [ -s "${response_file}" ]; then
      cat "${response_file}" >&2
      echo >&2
    fi
    exit 1
  fi

  API_RESPONSE_STATUS="${status}"
  API_RESPONSE_BODY="${response_file}"
  API_RESPONSE_URL="${url}"
}

print_recovery_guidance() {
  cat <<EOF
Recovery if auth/session 401 happens twice:
  curl -s -X PUT "${API_URL}/api/v1/admin/settings/line" -H "Authorization: Bearer {ADMIN_TOKEN}" -H "Content-Type: application/json" -d '{"mode":"tenant","channelId":"{CHANNEL_ID_FROM_CONSOLE}","channelSecret":"{CHANNEL_SECRET_FROM_CONSOLE}","channelAccessToken":"{LONG_LIVED_TOKEN_FROM_CONSOLE}","liffId":"{LIFF_ID_FROM_CONSOLE}"}'
EOF
}

fail_manual_preflight() {
  local blocker="$1"
  echo "ERROR: ${blocker}" >&2
  echo "Manual run is not ready." >&2
  print_recovery_guidance >&2
  exit 1
}

assert_success_response() {
  local label="$1"
  local url="$2"

  api_get_json "${url}"

  if [ "${API_RESPONSE_STATUS}" -lt 200 ] || [ "${API_RESPONSE_STATUS}" -ge 300 ]; then
    fail_manual_preflight "${label} returned HTTP ${API_RESPONSE_STATUS}: ${url} :: $(compact_response_body "${API_RESPONSE_BODY}")"
  fi

  if [ "$(jq -r '.success // empty' "${API_RESPONSE_BODY}")" != "true" ]; then
    local error_message=""
    error_message="$(jq -r '.error.message // empty' "${API_RESPONSE_BODY}")"
    if [ -n "${error_message}" ]; then
      fail_manual_preflight "${label} returned success=false: ${error_message}"
    fi
    fail_manual_preflight "${label} returned success=false: $(compact_response_body "${API_RESPONSE_BODY}")"
  fi
}

assert_nonempty_liff_id() {
  local liff_id=""
  liff_id="$(jq -r '.data.liffId // empty' "${API_RESPONSE_BODY}")"
  if [ -z "${liff_id}" ] || [ "${liff_id}" = "null" ]; then
    fail_manual_preflight "auth/config returned empty liffId for tenant '${TENANT_KEY}'. This is an ops/config blocker, not a repo-status pass."
  fi
}

assert_resolved_tenant_key() {
  local label="$1"
  local resolved_tenant_key=""
  resolved_tenant_key="$(jq -r '.data.tenantKey // empty' "${API_RESPONSE_BODY}")"
  if [ -n "${resolved_tenant_key}" ] && [ "${resolved_tenant_key}" != "${TENANT_KEY}" ]; then
    fail_manual_preflight "${label} returned tenantKey='${resolved_tenant_key}' but expected '${TENANT_KEY}'"
  fi
}

PROJECT_ID="${PROJECT_ID:-keyexpress-reserve}"
REGION="${REGION:-asia-northeast1}"

case "${TARGET_ENV}" in
  dev-v3)
    API_SERVICE="${API_SERVICE:-reserve-api-dev-v3}"
    CUSTOMER_SERVICE="${CUSTOMER_SERVICE:-reserve-customer-dev-v3}"
    LOG_SERVICE="${LOG_SERVICE:-reserve-api-dev-v3}"
    DEFAULT_API_URL="https://reserve-api-dev-v3-czjwiprc2q-an.a.run.app"
    DEFAULT_CUSTOMER_URL="https://reserve-customer-dev-v3-czjwiprc2q-an.a.run.app"
    ;;
  live)
    API_SERVICE="${API_SERVICE:-reserve-api}"
    CUSTOMER_SERVICE="${CUSTOMER_SERVICE:-reserve-customer}"
    LOG_SERVICE="${LOG_SERVICE:-reserve-api}"
    DEFAULT_API_URL=""
    DEFAULT_CUSTOMER_URL=""
    ;;
esac

require_command curl
require_command jq
require_command python3

API_URL="${API_URL:-}"
CUSTOMER_URL="${CUSTOMER_URL:-}"
TENANT_KEY="${TENANT_KEY:-}"
BOOKING_TOKEN="${BOOKING_TOKEN:-}"

RESOLVED_INPUT_JSON=""
if [ -n "${INPUT_JSON:-}" ]; then
  RESOLVED_INPUT_JSON="${INPUT_JSON}"
elif [ "${TARGET_ENV}" = "dev-v3" ]; then
  RESOLVED_INPUT_JSON="$(latest_public_onboarding_json "${TARGET_ENV}")"
fi

if [ -n "${RESOLVED_INPUT_JSON}" ]; then
  if [ ! -f "${RESOLVED_INPUT_JSON}" ]; then
    echo "ERROR: INPUT_JSON not found: ${RESOLVED_INPUT_JSON}" >&2
    exit 1
  fi

  if [ -z "${API_URL}" ]; then
    API_URL="$(read_json_field apiUrl "${RESOLVED_INPUT_JSON}")"
  fi
  if [ -z "${CUSTOMER_URL}" ]; then
    CUSTOMER_URL="$(read_json_field customerUrl "${RESOLVED_INPUT_JSON}")"
  fi
  if [ -z "${TENANT_KEY}" ]; then
    TENANT_KEY="$(read_json_field tenantKey "${RESOLVED_INPUT_JSON}")"
  fi
  if [ -z "${BOOKING_TOKEN}" ]; then
    BOOKING_TOKEN="$(read_json_field bookingLinkToken "${RESOLVED_INPUT_JSON}")"
  fi
fi

if [ -z "${API_URL}" ]; then
  API_URL="${DEFAULT_API_URL}"
fi
if [ -z "${CUSTOMER_URL}" ]; then
  CUSTOMER_URL="${DEFAULT_CUSTOMER_URL}"
fi

if [ -z "${API_URL}" ]; then
  API_URL="$(resolve_service_url "${API_SERVICE}")"
fi
if [ -z "${CUSTOMER_URL}" ]; then
  CUSTOMER_URL="$(resolve_service_url "${CUSTOMER_SERVICE}")"
fi

if [ -z "${TENANT_KEY}" ] || [ -z "${BOOKING_TOKEN}" ]; then
  if [ "${TARGET_ENV}" = "dev-v3" ]; then
    echo "ERROR: dev-v3 requires fresh TENANT_KEY and BOOKING_TOKEN input. Set them explicitly, pass INPUT_JSON, or run 'bash scripts/run_feature_verification.sh dev-v3' to produce scripts/out/feature_verification/dev-v3/*/public_onboarding.json." >&2
  else
    echo "ERROR: ${TARGET_ENV} requires TENANT_KEY and BOOKING_TOKEN. Set them explicitly or pass INPUT_JSON from scripts/smoke_public_onboarding.sh." >&2
  fi
  exit 1
fi

ROOT_URL="${ROOT_URL:-${CUSTOMER_URL%/}/}"
BOOKING_TOKEN_URL="${BOOKING_TOKEN_URL:-${CUSTOMER_URL%/}/?t=${BOOKING_TOKEN}}"
TEMPLATE_PATH="${TEMPLATE_PATH:-docs/runbooks/reserve-v3-findings.template.md}"
OUTPUT_PATH="${OUTPUT_PATH:-/tmp/reserve-v3-findings.${TARGET_ENV}.md}"

TEMPLATE_ABS_PATH="${REPO_ROOT}/${TEMPLATE_PATH}"
if [ ! -f "${TEMPLATE_ABS_PATH}" ]; then
  echo "ERROR: template not found: ${TEMPLATE_ABS_PATH}" >&2
  exit 1
fi

AUTH_CONFIG_URL="${API_URL}/api/v1/${TENANT_KEY}/auth/config"
TOKEN_ONLY_RESOLVE_URL="${API_URL}/api/platform/v1/booking-links/resolve?token=${BOOKING_TOKEN}"
TENANT_SCOPED_RESOLVE_URL="${API_URL}/api/platform/v1/booking-links/resolve?token=${BOOKING_TOKEN}&tenantKey=${TENANT_KEY}"

assert_success_response "auth/config" "${AUTH_CONFIG_URL}"
assert_nonempty_liff_id
assert_success_response "token-only booking-link resolve" "${TOKEN_ONLY_RESOLVE_URL}"
assert_resolved_tenant_key "token-only booking-link resolve"
assert_success_response "tenant-scoped booking-link resolve" "${TENANT_SCOPED_RESOLVE_URL}"
assert_resolved_tenant_key "tenant-scoped booking-link resolve"

mkdir -p "$(dirname "${OUTPUT_PATH}")"

PROJECT_ID="${PROJECT_ID}" \
API_URL="${API_URL}" \
CUSTOMER_URL="${CUSTOMER_URL}" \
ROOT_URL="${ROOT_URL}" \
BOOKING_TOKEN_URL="${BOOKING_TOKEN_URL}" \
TENANT_KEY="${TENANT_KEY}" \
BOOKING_TOKEN="${BOOKING_TOKEN}" \
OUTPUT_PATH="${OUTPUT_PATH}" \
TARGET_ENV="${TARGET_ENV}" \
python3 - "${TEMPLATE_ABS_PATH}" "${OUTPUT_PATH}" <<'PY'
from pathlib import Path
import datetime
import os
import sys

template_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])

values = {
    "{{DATE}}": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
    "{{PROJECT_ID}}": os.environ["PROJECT_ID"],
    "{{API_URL}}": os.environ["API_URL"],
    "{{CUSTOMER_URL}}": os.environ["CUSTOMER_URL"],
    "{{ROOT_URL}}": os.environ["ROOT_URL"],
    "{{BOOKING_TOKEN_URL}}": os.environ["BOOKING_TOKEN_URL"],
    "{{TENANT_KEY}}": os.environ["TENANT_KEY"],
    "{{BOOKING_TOKEN}}": os.environ["BOOKING_TOKEN"],
    "{{OUTPUT_PATH}}": os.environ["OUTPUT_PATH"],
}

content = template_path.read_text(encoding="utf-8")
for token, value in values.items():
    content = content.replace(token, value)
content = content.replace("# reserve-v3 real LINE smoke findings", f"# reserve-v3 real LINE smoke findings ({os.environ['TARGET_ENV']})", 1)
output_path.write_text(content, encoding="utf-8")
PY

cat <<EOF
Prepared findings workbook: ${OUTPUT_PATH}
Environment: ${TARGET_ENV}
Preflight status: PASS
Input source: ${RESOLVED_INPUT_JSON:-explicit env / service defaults}

Root URL:
  ${ROOT_URL}

Booking token URL:
  ${BOOKING_TOKEN_URL}

Preflight:
  curl -s "${AUTH_CONFIG_URL}" | jq '{success:.success, liffId:.data.liffId, mode:.data.lineMode, source:.data.lineConfigSource, storeId:.data.storeId}'
  curl -s "${TOKEN_ONLY_RESOLVE_URL}" | jq '{success:.success, tenantKey:.data.tenantKey, storeId:.data.storeId, practitionerId:.data.practitionerId}'
  curl -s "${TENANT_SCOPED_RESOLVE_URL}" | jq '{success:.success, tenantKey:.data.tenantKey, storeId:.data.storeId, practitionerId:.data.practitionerId}'

Log watch:
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="${LOG_SERVICE}"' --limit=50 --format='value(timestamp,textPayload,jsonPayload.message)' --freshness=5m --project="${PROJECT_ID}"

$(print_recovery_guidance)
EOF
