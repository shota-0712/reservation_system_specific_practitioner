#!/usr/bin/env bash
set -euo pipefail

: "${INPUT_JSON:?INPUT_JSON is required (output from scripts/smoke_public_onboarding.sh)}"

OUTPUT_JSON="${OUTPUT_JSON:-}"
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

read_json_field() {
  local key="$1"
  jq -r --arg key "${key}" '.[$key] // empty' "${INPUT_JSON}"
}

API_URL="${API_URL:-$(read_json_field apiUrl)}"
TENANT_KEY="${TENANT_KEY:-$(read_json_field tenantKey)}"
TENANT_ID="${TENANT_ID:-$(read_json_field tenantId)}"
STORE_ID="${STORE_ID:-$(read_json_field storeId)}"
ADMIN_ID="${ADMIN_ID:-$(read_json_field adminId)}"
ID_TOKEN="${ID_TOKEN:-$(read_json_field idToken)}"
MENU_ID="${MENU_ID:-$(read_json_field menuId)}"
PRACTITIONER_ID="${PRACTITIONER_ID:-$(read_json_field practitionerId)}"
BOOKING_LINK_TOKEN="${BOOKING_LINK_TOKEN:-$(read_json_field bookingLinkToken)}"

for required_var in API_URL TENANT_KEY TENANT_ID STORE_ID ADMIN_ID ID_TOKEN MENU_ID PRACTITIONER_ID; do
  if [ -z "${!required_var}" ]; then
    echo "ERROR: '${required_var}' is required. Check ${INPUT_JSON} or override the env var." >&2
    exit 1
  fi
done

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
  local scoped_store_id="${5:-}"

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
  if [ -n "${scoped_store_id}" ]; then
    curl_args+=(--header "X-Store-Id: ${scoped_store_id}")
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
    echo "ERROR: ${context} returned success=false" >&2
    echo "${json}" >&2
    exit 1
  fi
}

admin_request() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  api_request "${method}" "${url}" "${body}" "${ID_TOKEN}" "${STORE_ID}"
}

jst_date() {
  local offset_days="$1"
  python3 - <<PY
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

base = datetime.now(ZoneInfo("${TIMEZONE}")).date()
print((base + timedelta(days=${offset_days})).isoformat())
PY
}

echo "== 1) tenant/auth admin context =="
admin_context="$(api_request GET "${API_URL}/api/platform/v1/admin/context?tenantKey=${TENANT_KEY}" "" "${ID_TOKEN}")"
expect_success "${admin_context}" "platform/admin/context"
resolved_tenant_id="$(echo "${admin_context}" | jq -r '.data.tenantId')"
if [ "${resolved_tenant_id}" != "${TENANT_ID}" ]; then
  echo "ERROR: admin/context tenant mismatch (${resolved_tenant_id} != ${TENANT_ID})" >&2
  exit 1
fi
if ! echo "${admin_context}" | jq -e --arg storeId "${STORE_ID}" '.data.storeIds | index($storeId) != null' >/dev/null; then
  echo "ERROR: admin/context did not include store scope ${STORE_ID}" >&2
  echo "${admin_context}" >&2
  exit 1
fi

echo "== 2) catalog/staff assignment round-trip =="
option_payload='{"name":"スモークオプション","description":"admin capabilities option","duration":10,"price":1100}'
option_response="$(admin_request POST "${API_URL}/api/v1/admin/options" "${option_payload}")"
expect_success "${option_response}" "admin/options(create)"
option_id="$(echo "${option_response}" | jq -r '.data.id')"
if [ -z "${option_id}" ] || [ "${option_id}" = "null" ]; then
  echo "ERROR: option id missing" >&2
  echo "${option_response}" >&2
  exit 1
fi

practitioner_stores_put="$(admin_request PUT "${API_URL}/api/v1/admin/assignments/practitioners/${PRACTITIONER_ID}/stores" "{\"ids\":[\"${STORE_ID}\"]}")"
expect_success "${practitioner_stores_put}" "assignments/practitioners/stores(put)"
practitioner_stores_get="$(admin_request GET "${API_URL}/api/v1/admin/assignments/practitioners/${PRACTITIONER_ID}/stores")"
expect_success "${practitioner_stores_get}" "assignments/practitioners/stores(get)"
if ! echo "${practitioner_stores_get}" | jq -e --arg storeId "${STORE_ID}" '.data.storeIds == [$storeId]' >/dev/null; then
  echo "ERROR: practitioner store assignment mismatch" >&2
  echo "${practitioner_stores_get}" >&2
  exit 1
fi

menu_practitioners_put="$(admin_request PUT "${API_URL}/api/v1/admin/assignments/menus/${MENU_ID}/practitioners" "{\"ids\":[\"${PRACTITIONER_ID}\"]}")"
expect_success "${menu_practitioners_put}" "assignments/menus/practitioners(put)"
menu_practitioners_get="$(admin_request GET "${API_URL}/api/v1/admin/assignments/menus/${MENU_ID}/practitioners")"
expect_success "${menu_practitioners_get}" "assignments/menus/practitioners(get)"
if ! echo "${menu_practitioners_get}" | jq -e --arg practitionerId "${PRACTITIONER_ID}" '.data.practitionerIds == [$practitionerId]' >/dev/null; then
  echo "ERROR: menu practitioner assignment mismatch" >&2
  echo "${menu_practitioners_get}" >&2
  exit 1
fi

option_menus_put="$(admin_request PUT "${API_URL}/api/v1/admin/assignments/options/${option_id}/menus" "{\"ids\":[\"${MENU_ID}\"]}")"
expect_success "${option_menus_put}" "assignments/options/menus(put)"
option_menus_get="$(admin_request GET "${API_URL}/api/v1/admin/assignments/options/${option_id}/menus")"
expect_success "${option_menus_get}" "assignments/options/menus(get)"
if ! echo "${option_menus_get}" | jq -e --arg menuId "${MENU_ID}" '.data.menuIds == [$menuId]' >/dev/null; then
  echo "ERROR: option menu assignment mismatch" >&2
  echo "${option_menus_get}" >&2
  exit 1
fi

admin_stores_put="$(admin_request PUT "${API_URL}/api/v1/admin/assignments/admins/${ADMIN_ID}/stores" "{\"ids\":[\"${STORE_ID}\"]}")"
expect_success "${admin_stores_put}" "assignments/admins/stores(put)"
admin_stores_get="$(admin_request GET "${API_URL}/api/v1/admin/assignments/admins/${ADMIN_ID}/stores")"
expect_success "${admin_stores_get}" "assignments/admins/stores(get)"
if ! echo "${admin_stores_get}" | jq -e --arg storeId "${STORE_ID}" '.data.storeIds == [$storeId]' >/dev/null; then
  echo "ERROR: admin store assignment mismatch" >&2
  echo "${admin_stores_get}" >&2
  exit 1
fi

public_menus="$(api_request GET "${API_URL}/api/v1/${TENANT_KEY}/menus/by-practitioner/${PRACTITIONER_ID}")"
expect_success "${public_menus}" "public menus/by-practitioner"
if ! echo "${public_menus}" | jq -e --arg menuId "${MENU_ID}" '[.data[].id] | index($menuId) != null' >/dev/null; then
  echo "ERROR: public menus/by-practitioner did not return ${MENU_ID}" >&2
  echo "${public_menus}" >&2
  exit 1
fi

public_practitioners="$(api_request GET "${API_URL}/api/v1/${TENANT_KEY}/practitioners/by-menu/${MENU_ID}?storeId=${STORE_ID}")"
expect_success "${public_practitioners}" "public practitioners/by-menu"
if ! echo "${public_practitioners}" | jq -e --arg practitionerId "${PRACTITIONER_ID}" '[.data[].id] | index($practitionerId) != null' >/dev/null; then
  echo "ERROR: public practitioners/by-menu did not return ${PRACTITIONER_ID}" >&2
  echo "${public_practitioners}" >&2
  exit 1
fi

public_options="$(api_request GET "${API_URL}/api/v1/${TENANT_KEY}/options?menuId=${MENU_ID}")"
expect_success "${public_options}" "public options"
if ! echo "${public_options}" | jq -e --arg optionId "${option_id}" '[.data[].id] | index($optionId) != null' >/dev/null; then
  echo "ERROR: public options did not return ${option_id}" >&2
  echo "${public_options}" >&2
  exit 1
fi

echo "== 3) settings smoke =="
settings_response="$(admin_request GET "${API_URL}/api/v1/admin/settings")"
expect_success "${settings_response}" "admin/settings"
if ! echo "${settings_response}" | jq -e --arg storeId "${STORE_ID}" '.data.store.id == $storeId' >/dev/null; then
  echo "ERROR: admin/settings store scope mismatch" >&2
  echo "${settings_response}" >&2
  exit 1
fi

notifications_before="$(admin_request GET "${API_URL}/api/v1/admin/settings/notifications")"
expect_success "${notifications_before}" "admin/settings/notifications(get)"
notifications_patch='{"lineReminder":false,"emailDailyReport":false}'
notifications_after="$(admin_request PUT "${API_URL}/api/v1/admin/settings/notifications" "${notifications_patch}")"
expect_success "${notifications_after}" "admin/settings/notifications(put)"
if ! echo "${notifications_after}" | jq -e '.data.lineReminder == false and .data.emailDailyReport == false' >/dev/null; then
  echo "ERROR: notification settings update mismatch" >&2
  echo "${notifications_after}" >&2
  exit 1
fi

echo "== 4) analytics / reports / dashboard =="
today_date="$(jst_date 0)"
yesterday_date="$(jst_date -1)"

analytics_yesterday="$(admin_request POST "${API_URL}/api/v1/admin/jobs/analytics/daily" "{\"date\":\"${yesterday_date}\"}")"
expect_success "${analytics_yesterday}" "admin/jobs/analytics/daily(yesterday)"
analytics_today="$(admin_request POST "${API_URL}/api/v1/admin/jobs/analytics/daily" "{\"date\":\"${today_date}\"}")"
expect_success "${analytics_today}" "admin/jobs/analytics/daily(today)"

today_rows_upserted="$(echo "${analytics_today}" | jq -r '.stats.rowsUpserted // 0')"
if [ "${today_rows_upserted}" -lt 1 ]; then
  echo "ERROR: analytics daily job did not upsert rows for today" >&2
  echo "${analytics_today}" >&2
  exit 1
fi

reports_summary="$(admin_request GET "${API_URL}/api/v1/admin/reports/summary?period=month")"
expect_success "${reports_summary}" "admin/reports/summary"
dashboard_kpi="$(admin_request GET "${API_URL}/api/v1/admin/dashboard/kpi")"
expect_success "${dashboard_kpi}" "admin/dashboard/kpi"
dashboard_activity="$(admin_request GET "${API_URL}/api/v1/admin/dashboard/activity?limit=10")"
expect_success "${dashboard_activity}" "admin/dashboard/activity"

activity_count="$(echo "${dashboard_activity}" | jq '.data | length')"
if [ "${activity_count}" -lt 1 ]; then
  echo "ERROR: dashboard activity returned no rows after admin mutations" >&2
  echo "${dashboard_activity}" >&2
  exit 1
fi

booking_link_resolve=""
booking_auth_config=""
if [ -n "${BOOKING_LINK_TOKEN}" ]; then
  echo "== 5) booking link resolve re-check =="
  booking_link_resolve="$(api_request GET "${API_URL}/api/platform/v1/booking-links/resolve?token=${BOOKING_LINK_TOKEN}&tenantKey=${TENANT_KEY}")"
  expect_success "${booking_link_resolve}" "platform/booking-links/resolve"
  booking_auth_config="$(api_request GET "${API_URL}/api/v1/${TENANT_KEY}/auth/config?practitionerId=${PRACTITIONER_ID}")"
  expect_success "${booking_auth_config}" "auth/config(by-practitioner)"
fi

if [ -n "${OUTPUT_JSON}" ]; then
  mkdir -p "$(dirname "${OUTPUT_JSON}")"
  jq -n \
    --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg apiUrl "${API_URL}" \
    --arg tenantKey "${TENANT_KEY}" \
    --arg tenantId "${TENANT_ID}" \
    --arg storeId "${STORE_ID}" \
    --arg adminId "${ADMIN_ID}" \
    --arg menuId "${MENU_ID}" \
    --arg practitionerId "${PRACTITIONER_ID}" \
    --arg optionId "${option_id}" \
    --arg todayDate "${today_date}" \
    --arg yesterdayDate "${yesterday_date}" \
    --argjson adminContext "${admin_context}" \
    --argjson practitionerStores "${practitioner_stores_get}" \
    --argjson menuPractitioners "${menu_practitioners_get}" \
    --argjson optionMenus "${option_menus_get}" \
    --argjson adminStores "${admin_stores_get}" \
    --argjson settings "${settings_response}" \
    --argjson notificationsBefore "${notifications_before}" \
    --argjson notificationsAfter "${notifications_after}" \
    --argjson analyticsToday "${analytics_today}" \
    --argjson analyticsYesterday "${analytics_yesterday}" \
    --argjson reportsSummary "${reports_summary}" \
    --argjson dashboardKpi "${dashboard_kpi}" \
    --argjson dashboardActivity "${dashboard_activity}" \
    --argjson publicMenus "${public_menus}" \
    --argjson publicPractitioners "${public_practitioners}" \
    --argjson publicOptions "${public_options}" \
    --arg bookingLinkToken "${BOOKING_LINK_TOKEN}" \
    --argjson bookingLinkResolve "${booking_link_resolve:-null}" \
    --argjson bookingAuthConfig "${booking_auth_config:-null}" \
    '{
      generatedAt: $generatedAt,
      apiUrl: $apiUrl,
      tenantKey: $tenantKey,
      tenantId: $tenantId,
      storeId: $storeId,
      adminId: $adminId,
      menuId: $menuId,
      practitionerId: $practitionerId,
      optionId: $optionId,
      analyticsDates: {
        today: $todayDate,
        yesterday: $yesterdayDate
      },
      adminContext: $adminContext.data,
      assignments: {
        practitionerStores: $practitionerStores.data,
        menuPractitioners: $menuPractitioners.data,
        optionMenus: $optionMenus.data,
        adminStores: $adminStores.data
      },
      publicReadPaths: {
        menusByPractitioner: $publicMenus.data,
        practitionersByMenu: $publicPractitioners.data,
        optionsByMenu: $publicOptions.data
      },
      settings: $settings.data,
      notificationsBefore: $notificationsBefore.data,
      notificationsAfter: $notificationsAfter.data,
      analyticsToday: $analyticsToday.stats,
      analyticsYesterday: $analyticsYesterday.stats,
      reportsSummary: $reportsSummary.data,
      dashboardKpi: $dashboardKpi.data,
      dashboardActivity: $dashboardActivity.data,
      bookingLinkToken: ($bookingLinkToken | select(length > 0)),
      bookingLinkResolve: $bookingLinkResolve,
      bookingAuthConfig: $bookingAuthConfig
    }' >"${OUTPUT_JSON}"
  echo "artifactJson: ${OUTPUT_JSON}"
fi

echo
echo "Admin capability smoke completed."
echo "tenantKey: ${TENANT_KEY}"
echo "storeId: ${STORE_ID}"
echo "adminId: ${ADMIN_ID}"
echo "optionId: ${option_id}"
