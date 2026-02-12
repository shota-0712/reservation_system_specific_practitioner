#!/usr/bin/env bash
set -euo pipefail

: "${API_URL:?API_URL is required (example: https://reserve-api-xxxx.a.run.app)}"
: "${FIREBASE_API_KEY:?FIREBASE_API_KEY is required (Firebase Web API key)}"

RUN_RESERVATION_TEST="${RUN_RESERVATION_TEST:-true}"

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
  for file in "${tmp_files[@]:-}"; do
    [ -f "${file}" ] && rm -f "${file}"
  done
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
if [ -z "${id_token}" ] || [ "${id_token}" = "null" ]; then
  echo "ERROR: failed to obtain Firebase ID token"
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
if [ -z "${tenant_key}" ] || [ "${tenant_key}" = "null" ]; then
  echo "ERROR: register response is missing tenantKey"
  echo "${register_response}"
  exit 1
fi

echo "== 4) tenant public auth config check =="
auth_config="$(api_request GET "${API_URL}/api/v1/${tenant_key}/auth/config")"
expect_success "${auth_config}" "auth/config"

echo "== 5) onboarding status update (pending -> in_progress -> completed) =="
status_before="$(api_request GET "${API_URL}/api/v1/${tenant_key}/admin/onboarding/status" "" "${id_token}")"
expect_success "${status_before}" "onboarding/status(before)"

update_in_progress_payload='{"status":"in_progress","onboardingPayload":{"source":"smoke-script","step":"in_progress"}}'
status_in_progress="$(api_request PATCH "${API_URL}/api/v1/${tenant_key}/admin/onboarding/status" "${update_in_progress_payload}" "${id_token}")"
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

status_completed="$(api_request PATCH "${API_URL}/api/v1/${tenant_key}/admin/onboarding/status" "${update_completed_payload}" "${id_token}")"
expect_success "${status_completed}" "onboarding/status(completed)"
if [ "$(echo "${status_completed}" | jq -r '.data.completed')" != "true" ]; then
  echo "ERROR: onboarding status did not transition to completed"
  echo "${status_completed}"
  exit 1
fi

reservation_id=""
if [ "${RUN_RESERVATION_TEST}" = "true" ]; then
  echo "== 6) admin reservation flow smoke =="
  menu_payload='{"name":"スモークカット","category":"カット","duration":60,"price":5500,"description":"smoke test menu"}'
  menu_response="$(api_request POST "${API_URL}/api/v1/${tenant_key}/admin/menus" "${menu_payload}" "${id_token}")"
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

  practitioner_response="$(api_request POST "${API_URL}/api/v1/${tenant_key}/admin/practitioners" "${practitioner_payload}" "${id_token}")"
  expect_success "${practitioner_response}" "admin/practitioners(create)"
  practitioner_id="$(echo "${practitioner_response}" | jq -r '.data.id')"

  reservation_date="$(python3 - <<'PY'
import datetime
today = datetime.date.today()
date = today + datetime.timedelta(days=1)
while date.weekday() == 6:  # Sunday
    date += datetime.timedelta(days=1)
print(date.isoformat())
PY
)"

  reservation_payload="$(jq -cn \
    --arg practitionerId "${practitioner_id}" \
    --arg menuId "${menu_id}" \
    --arg date "${reservation_date}" \
    '{
      customerName:"スモーク顧客",
      customerPhone:"09012345678",
      practitionerId:$practitionerId,
      menuIds:[$menuId],
      optionIds:[],
      date:$date,
      startTime:"10:00",
      status:"confirmed",
      source:"admin"
    }')"

  reservation_response="$(api_request POST "${API_URL}/api/v1/${tenant_key}/admin/reservations" "${reservation_payload}" "${id_token}")"
  expect_success "${reservation_response}" "admin/reservations(create)"
  reservation_id="$(echo "${reservation_response}" | jq -r '.data.id')"
fi

echo "== 7) slug availability after registration =="
slug_post="$(api_request GET "${API_URL}/api/platform/v1/onboarding/slug-availability?slug=${tenant_key}")"
expect_success "${slug_post}" "slug-availability(after)"
if [ "$(echo "${slug_post}" | jq -r '.data.available')" != "false" ]; then
  echo "ERROR: slug '${tenant_key}' should be unavailable after registration"
  exit 1
fi

echo
echo "Smoke test completed."
echo "tenantSlug: ${tenant_key}"
echo "tenantId: ${tenant_id}"
echo "ownerEmail: ${OWNER_EMAIL}"
if [ -n "${reservation_id}" ]; then
  echo "reservationId: ${reservation_id}"
fi
echo "customerUrl: ${CUSTOMER_URL:-<set CUSTOMER_URL to print tenant URL>}"
if [ -n "${CUSTOMER_URL:-}" ]; then
  echo "customerTenantUrl: ${CUSTOMER_URL}/?tenant=${tenant_key}"
fi
