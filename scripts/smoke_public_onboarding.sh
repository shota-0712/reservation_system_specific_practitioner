#!/usr/bin/env bash
set -euo pipefail

: "${API_URL:?API_URL is required (example: https://reserve-api-xxxx.a.run.app)}"
: "${FIREBASE_API_KEY:?FIREBASE_API_KEY is required (Firebase Web API key)}"

RUN_RESERVATION_TEST="${RUN_RESERVATION_TEST:-true}"
OUTPUT_JSON="${OUTPUT_JSON:-}"

timestamp="$(date +%s)"
TENANT_NAME="${TENANT_NAME:-Smoke Salon ${timestamp}}"
OWNER_EMAIL="${OWNER_EMAIL:-smoke.${timestamp}@example.com}"
OWNER_PASSWORD="${OWNER_PASSWORD:-SmokeTest!${timestamp}Aa}"
OWNER_NAME="${OWNER_NAME:-Smoke Owner}"
STORE_NAME="${STORE_NAME:-${TENANT_NAME} 本店}"
TIMEZONE="${TIMEZONE:-Asia/Tokyo}"

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "ERROR: '${cmd}' command is required."
    exit 1
  fi
}

require_command curl
require_command jq
require_command python3

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

api_request() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local auth_token="${4:-}"

  local response_file
  response_file="$(mktemp)"
  tmp_files+=("${response_file}")

  local curl_args=(
    --silent
    --show-error
    --output "${response_file}"
    --write-out "%{http_code}"
    --request "${method}"
    "${url}"
  )

  if [ -n "${auth_token}" ]; then
    curl_args+=(--header "Authorization: Bearer ${auth_token}")
  fi

  if [ -n "${body}" ]; then
    curl_args+=(--header "Content-Type: application/json" --data "${body}")
  fi

  local status=""
  local curl_exit=0
  set +e
  status="$(curl "${curl_args[@]}")"
  curl_exit=$?
  set -e

  if [ "${curl_exit}" -ne 0 ]; then
    echo "ERROR: curl transport failed for ${method} ${url} (exit=${curl_exit})" >&2
    if [ -s "${response_file}" ]; then
      cat "${response_file}" >&2
      echo >&2
    fi
    exit 1
  fi

  if [ "${status}" -lt 200 ] || [ "${status}" -ge 300 ]; then
    echo "ERROR: ${method} ${url} failed with status ${status}" >&2
    cat "${response_file}" >&2
    echo >&2
    exit 1
  fi

  cat "${response_file}"
}

expect_success() {
  local json="$1"
  local context="$2"
  if [ "$(echo "${json}" | jq -r '.success // empty')" != "true" ]; then
    echo "ERROR: ${context} returned success=false"
    echo "${json}"
    exit 1
  fi
}

echo "== 1) registration-config check =="
registration_config="$(api_request GET "${API_URL}/api/platform/v1/onboarding/registration-config")"
expect_success "${registration_config}" "registration-config"
if [ "$(echo "${registration_config}" | jq -r '.data.enabled')" != "true" ]; then
  echo "ERROR: public onboarding is disabled"
  exit 1
fi

echo "== 2) Firebase owner signup =="
firebase_signup_payload="$(jq -cn \
  --arg email "${OWNER_EMAIL}" \
  --arg password "${OWNER_PASSWORD}" \
  '{email:$email,password:$password,returnSecureToken:true}')"

firebase_signup_response="$(api_request POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}" "${firebase_signup_payload}")"
id_token="$(echo "${firebase_signup_response}" | jq -r '.idToken')"
refresh_token="$(echo "${firebase_signup_response}" | jq -r '.refreshToken')"
if [ -z "${id_token}" ] || [ "${id_token}" = "null" ]; then
  echo "ERROR: failed to obtain Firebase ID token"
  echo "${firebase_signup_response}"
  exit 1
fi
if [ -z "${refresh_token}" ] || [ "${refresh_token}" = "null" ]; then
  echo "ERROR: failed to obtain Firebase refresh token"
  echo "${firebase_signup_response}"
  exit 1
fi

echo "== 3) public tenant registration =="
register_payload="$(jq -cn \
  --arg idToken "${id_token}" \
  --arg tenantName "${TENANT_NAME}" \
  --arg ownerName "${OWNER_NAME}" \
  --arg storeName "${STORE_NAME}" \
  --arg timezone "${TIMEZONE}" \
  '{
    idToken:$idToken,
    tenantName:$tenantName,
    ownerName:$ownerName,
    storeName:$storeName,
    timezone:$timezone
  }')"

register_response="$(api_request POST "${API_URL}/api/platform/v1/onboarding/register" "${register_payload}")"
expect_success "${register_response}" "onboarding/register"
tenant_key="$(echo "${register_response}" | jq -r '.data.tenantKey')"
tenant_id="$(echo "${register_response}" | jq -r '.data.tenantId')"
store_id="$(echo "${register_response}" | jq -r '.data.storeId // empty')"
admin_id="$(echo "${register_response}" | jq -r '.data.adminId // empty')"
if [ -z "${tenant_key}" ] || [ "${tenant_key}" = "null" ]; then
  echo "ERROR: register response is missing tenantKey"
  echo "${register_response}"
  exit 1
fi

echo "== 4) tenant public auth config check =="
auth_config="$(api_request GET "${API_URL}/api/v1/${tenant_key}/auth/config")"
expect_success "${auth_config}" "auth/config"
auth_config_store_id="$(echo "${auth_config}" | jq -r '.data.store.id // .data.storeId // empty')"
if [ -z "${store_id}" ] && [ -n "${auth_config_store_id}" ] && [ "${auth_config_store_id}" != "null" ]; then
  store_id="${auth_config_store_id}"
fi

echo "== 5) sync admin claims and refresh token =="
claims_sync_response="$(api_request POST "${API_URL}/api/platform/v1/admin/claims/sync" "" "${id_token}")"
expect_success "${claims_sync_response}" "admin/claims/sync"

refresh_response_file="$(mktemp)"
tmp_files+=("${refresh_response_file}")
refresh_token_encoded="$(jq -rn --arg value "${refresh_token}" '$value|@uri')"
refresh_payload="grant_type=refresh_token&refresh_token=${refresh_token_encoded}"
refresh_status="$(
  curl \
    --silent \
    --show-error \
    --output "${refresh_response_file}" \
    --write-out "%{http_code}" \
    --request POST \
    --header "Content-Type: application/x-www-form-urlencoded" \
    --data "${refresh_payload}" \
    "https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}"
)"

if [ "${refresh_status}" -lt 200 ] || [ "${refresh_status}" -ge 300 ]; then
  echo "ERROR: token refresh failed with status ${refresh_status}"
  cat "${refresh_response_file}"
  echo
  exit 1
fi

id_token="$(jq -r '.id_token' "${refresh_response_file}")"
refresh_token="$(jq -r '.refresh_token' "${refresh_response_file}")"
if [ -z "${id_token}" ] || [ "${id_token}" = "null" ]; then
  echo "ERROR: refreshed ID token is missing"
  cat "${refresh_response_file}"
  echo
  exit 1
fi

echo "== 6) onboarding status update (pending -> in_progress -> completed) =="
status_before="$(api_request GET "${API_URL}/api/v1/admin/onboarding/status" "" "${id_token}")"
expect_success "${status_before}" "onboarding/status(before)"

update_in_progress_payload='{"status":"in_progress","onboardingPayload":{"source":"smoke-script","step":"in_progress"}}'
status_in_progress="$(api_request PATCH "${API_URL}/api/v1/admin/onboarding/status" "${update_in_progress_payload}" "${id_token}")"
expect_success "${status_in_progress}" "onboarding/status(in_progress)"

update_completed_payload="$(jq -cn \
  --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{
    status:"completed",
    onboardingPayload:{
      source:"smoke-script",
      completedAt:$completedAt
    }
  }')"

status_completed="$(api_request PATCH "${API_URL}/api/v1/admin/onboarding/status" "${update_completed_payload}" "${id_token}")"
expect_success "${status_completed}" "onboarding/status(completed)"
if [ "$(echo "${status_completed}" | jq -r '.data.completed')" != "true" ]; then
  echo "ERROR: onboarding status did not transition to completed"
  echo "${status_completed}"
  exit 1
fi

reservation_id=""
booking_link_token=""
menu_id=""
practitioner_id=""
reservation_date=""
reservation_starts_at=""
if [ "${RUN_RESERVATION_TEST}" = "true" ]; then
  echo "== 7) admin reservation flow smoke =="
  menu_payload='{"name":"スモークカット","category":"カット","duration":60,"price":5500,"description":"smoke test menu"}'
  menu_response="$(api_request POST "${API_URL}/api/v1/admin/menus" "${menu_payload}" "${id_token}")"
  expect_success "${menu_response}" "admin/menus(create)"
  menu_id="$(echo "${menu_response}" | jq -r '.data.id')"

  practitioner_payload="$(jq -cn \
    --arg menuId "${menu_id}" \
    '{
      name:"スモーク担当",
      role:"stylist",
      color:"#3b82f6",
      schedule:{
        workDays:[1,2,3,4,5,6],
        workHours:{start:"10:00",end:"19:00"}
      },
      availableMenuIds:[$menuId]
    }')"

  practitioner_response="$(api_request POST "${API_URL}/api/v1/admin/practitioners" "${practitioner_payload}" "${id_token}")"
  expect_success "${practitioner_response}" "admin/practitioners(create)"
  practitioner_id="$(echo "${practitioner_response}" | jq -r '.data.id')"

  echo "== 8) booking link token create/resolve =="
  booking_link_payload="$(jq -cn --arg practitionerId "${practitioner_id}" '{practitionerId:$practitionerId,reissue:true}')"
  booking_link_response="$(api_request POST "${API_URL}/api/v1/admin/booking-links" "${booking_link_payload}" "${id_token}")"
  expect_success "${booking_link_response}" "admin/booking-links(create)"
  booking_link_token="$(echo "${booking_link_response}" | jq -r '.data.token')"
  if [ -z "${booking_link_token}" ] || [ "${booking_link_token}" = "null" ]; then
    echo "ERROR: booking link token was not returned"
    echo "${booking_link_response}"
    exit 1
  fi

  booking_link_resolve_token_only="$(api_request GET "${API_URL}/api/platform/v1/booking-links/resolve?token=${booking_link_token}")"
  expect_success "${booking_link_resolve_token_only}" "platform/booking-links/resolve(token-only)"
  resolved_tenant_key="$(echo "${booking_link_resolve_token_only}" | jq -r '.data.tenantKey')"
  resolved_practitioner_id="$(echo "${booking_link_resolve_token_only}" | jq -r '.data.practitionerId')"
  if [ "${resolved_tenant_key}" != "${tenant_key}" ] || [ "${resolved_practitioner_id}" != "${practitioner_id}" ]; then
    echo "ERROR: token-only booking link resolve mismatch"
    echo "${booking_link_resolve_token_only}"
    exit 1
  fi

  booking_link_resolve="$(api_request GET "${API_URL}/api/platform/v1/booking-links/resolve?token=${booking_link_token}&tenantKey=${tenant_key}")"
  expect_success "${booking_link_resolve}" "platform/booking-links/resolve(tenant-scoped)"
  resolved_tenant_key="$(echo "${booking_link_resolve}" | jq -r '.data.tenantKey')"
  resolved_practitioner_id="$(echo "${booking_link_resolve}" | jq -r '.data.practitionerId')"
  if [ "${resolved_tenant_key}" != "${tenant_key}" ] || [ "${resolved_practitioner_id}" != "${practitioner_id}" ]; then
    echo "ERROR: tenant-scoped booking link resolve mismatch"
    echo "${booking_link_resolve}"
    exit 1
  fi

  reservation_date="$(python3 - <<'PY'
import datetime
today = datetime.date.today()
date = today + datetime.timedelta(days=1)
while date.weekday() == 6:  # Sunday
    date += datetime.timedelta(days=1)
print(date.isoformat())
PY
)"

  reservation_starts_at="$(python3 - <<PY
from datetime import datetime
from zoneinfo import ZoneInfo

date = "${reservation_date}"
timezone = "${TIMEZONE}"
local_dt = datetime.fromisoformat(f"{date}T10:00:00").replace(tzinfo=ZoneInfo(timezone))
print(local_dt.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z"))
PY
)"

  reservation_payload="$(jq -cn \
    --arg practitionerId "${practitioner_id}" \
    --arg menuId "${menu_id}" \
    --arg startsAt "${reservation_starts_at}" \
    --arg timezone "${TIMEZONE}" \
    '{
      customerName:"スモーク顧客",
      customerPhone:"09012345678",
      practitionerId:$practitionerId,
      menuIds:[$menuId],
      optionIds:[],
      startsAt:$startsAt,
      timezone:$timezone,
      status:"confirmed",
      source:"admin"
    }')"

  reservation_response="$(api_request POST "${API_URL}/api/v1/admin/reservations" "${reservation_payload}" "${id_token}")"
  expect_success "${reservation_response}" "admin/reservations(create)"
  reservation_id="$(echo "${reservation_response}" | jq -r '.data.id')"

  # customer-app flow compatibility: token resolve result can drive auth/config
  auth_config_by_token="$(api_request GET "${API_URL}/api/v1/${tenant_key}/auth/config?practitionerId=${practitioner_id}")"
  expect_success "${auth_config_by_token}" "auth/config(by-token-context)"
fi

echo
echo "Smoke test completed."
echo "tenantSlug: ${tenant_key}"
echo "tenantId: ${tenant_id}"
echo "ownerEmail: ${OWNER_EMAIL}"
if [ -n "${reservation_id}" ]; then
  echo "reservationId: ${reservation_id}"
fi
if [ -n "${booking_link_token}" ]; then
  echo "bookingLinkToken: ${booking_link_token}"
fi
echo "customerUrl: ${CUSTOMER_URL:-<set CUSTOMER_URL to print tenant URL>}"
customer_tenant_url=""
customer_token_url=""
if [ -n "${CUSTOMER_URL:-}" ]; then
  customer_tenant_url="${CUSTOMER_URL}/?tenant=${tenant_key}"
  echo "customerTenantUrl: ${customer_tenant_url}"
  if [ -n "${booking_link_token}" ]; then
    customer_token_url="${CUSTOMER_URL}/?t=${booking_link_token}"
    echo "customerTokenUrl: ${customer_token_url}"
  fi
fi
if [ -n "${OUTPUT_JSON}" ]; then
  mkdir -p "$(dirname "${OUTPUT_JSON}")"
  jq -n \
    --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg apiUrl "${API_URL}" \
    --arg customerUrl "${CUSTOMER_URL:-}" \
    --arg tenantName "${TENANT_NAME}" \
    --arg tenantKey "${tenant_key}" \
    --arg tenantId "${tenant_id}" \
    --arg storeId "${store_id:-}" \
    --arg adminId "${admin_id:-}" \
    --arg ownerEmail "${OWNER_EMAIL}" \
    --arg ownerName "${OWNER_NAME}" \
    --arg idToken "${id_token}" \
    --arg refreshToken "${refresh_token}" \
    --arg reservationId "${reservation_id}" \
    --arg reservationDate "${reservation_date}" \
    --arg reservationStartsAt "${reservation_starts_at}" \
    --arg menuId "${menu_id}" \
    --arg practitionerId "${practitioner_id}" \
    --arg bookingLinkToken "${booking_link_token}" \
    --arg customerTenantUrl "${customer_tenant_url}" \
    --arg customerTokenUrl "${customer_token_url}" \
    '{
      generatedAt: $generatedAt,
      apiUrl: $apiUrl,
      customerUrl: $customerUrl,
      tenantName: $tenantName,
      tenantKey: $tenantKey,
      tenantId: $tenantId,
      storeId: ($storeId | select(length > 0)),
      adminId: ($adminId | select(length > 0)),
      ownerEmail: $ownerEmail,
      ownerName: $ownerName,
      idToken: $idToken,
      refreshToken: $refreshToken,
      reservationId: ($reservationId | select(length > 0)),
      reservationDate: ($reservationDate | select(length > 0)),
      reservationStartsAt: ($reservationStartsAt | select(length > 0)),
      menuId: ($menuId | select(length > 0)),
      practitionerId: ($practitionerId | select(length > 0)),
      bookingLinkToken: ($bookingLinkToken | select(length > 0)),
      customerTenantUrl: ($customerTenantUrl | select(length > 0)),
      customerTokenUrl: ($customerTokenUrl | select(length > 0))
    }' >"${OUTPUT_JSON}"
  echo "artifactJson: ${OUTPUT_JSON}"
fi
