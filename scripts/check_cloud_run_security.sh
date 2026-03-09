#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID is required}"

REGION="${REGION:-asia-northeast1}"
SERVICES="${SERVICES:-reserve-api,reserve-admin,reserve-customer,reserve-landing}"
EXPECTED_PUBLIC_SERVICES="${EXPECTED_PUBLIC_SERVICES:-reserve-api,reserve-admin,reserve-customer,reserve-landing}"
EXPECTED_INGRESS="${EXPECTED_INGRESS:-reserve-api=all,reserve-admin=all,reserve-customer=all,reserve-landing=all}"
STRICT_NON_DEFAULT_SERVICE_ACCOUNT="${STRICT_NON_DEFAULT_SERVICE_ACCOUNT:-false}"

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

csv_contains() {
  local needle="$1"
  local csv="$2"
  local item
  IFS=',' read -r -a items <<< "${csv}"
  for item in "${items[@]}"; do
    item="$(trim "$item")"
    if [ "${item}" = "${needle}" ]; then
      return 0
    fi
  done
  return 1
}

expected_ingress_for() {
  local service="$1"
  local pair key value
  IFS=',' read -r -a pairs <<< "${EXPECTED_INGRESS}"
  for pair in "${pairs[@]}"; do
    pair="$(trim "$pair")"
    if [[ "${pair}" != *=* ]]; then
      continue
    fi
    key="$(trim "${pair%%=*}")"
    value="$(trim "${pair#*=}")"
    if [ "${key}" = "${service}" ]; then
      printf '%s' "${value}"
      return 0
    fi
  done
  return 1
}

is_default_compute_sa() {
  local sa="$1"
  [[ "${sa}" =~ -compute@developer\.gserviceaccount\.com$ ]]
}

failures=0
warnings=0

echo "INFO: project=${PROJECT_ID} region=${REGION}"

IFS=',' read -r -a service_list <<< "${SERVICES}"
for raw_service in "${service_list[@]}"; do
  service="$(trim "${raw_service}")"
  if [ -z "${service}" ]; then
    continue
  fi

  service_account="$(
    gcloud run services describe "${service}" \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || true
  )"
  service_account="$(trim "${service_account}")"

  ingress="$(
    gcloud run services describe "${service}" \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --format='value(spec.ingress)' 2>/dev/null || true
  )"
  ingress="$(trim "${ingress}")"
  if [ -z "${ingress}" ]; then
    ingress="$(
      gcloud run services describe "${service}" \
        --project "${PROJECT_ID}" \
        --region "${REGION}" \
        --format='value(metadata.annotations.run.googleapis.com/ingress)' 2>/dev/null || true
    )"
    ingress="$(trim "${ingress}")"
  fi

  public_invoker="$(
    gcloud run services get-iam-policy "${service}" \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --flatten='bindings[].members' \
      --filter='bindings.role:roles/run.invoker AND bindings.members:allUsers' \
      --format='value(bindings.members)' 2>/dev/null || true
  )"
  public_invoker="$(trim "${public_invoker}")"
  if [ "${public_invoker}" = "allUsers" ]; then
    is_public="true"
  else
    is_public="false"
  fi

  echo "INFO: ${service} ingress=${ingress:-<unknown>} public=${is_public} service_account=${service_account:-<unset>}"

  expected_ingress=""
  if expected_ingress="$(expected_ingress_for "${service}")"; then
    case "${expected_ingress}" in
      all|internal|internal-and-cloud-load-balancing) ;;
      *)
        echo "FAIL: ${service} has invalid EXPECTED_INGRESS value '${expected_ingress}'"
        failures=$((failures + 1))
        continue
        ;;
    esac
    if [ "${ingress}" != "${expected_ingress}" ]; then
      echo "FAIL: ${service} ingress=${ingress:-<unknown>} (expected ${expected_ingress})"
      failures=$((failures + 1))
    fi
  fi

  if csv_contains "${service}" "${EXPECTED_PUBLIC_SERVICES}"; then
    if [ "${is_public}" != "true" ]; then
      echo "FAIL: ${service} is expected to be public, but allUsers invoker is missing."
      failures=$((failures + 1))
    fi
  else
    if [ "${is_public}" = "true" ]; then
      echo "FAIL: ${service} is expected to be private, but allUsers invoker is configured."
      failures=$((failures + 1))
    fi
  fi

  if [ "${STRICT_NON_DEFAULT_SERVICE_ACCOUNT}" = "true" ]; then
    if [ -z "${service_account}" ]; then
      echo "FAIL: ${service} has no explicit runtime service account."
      failures=$((failures + 1))
    elif is_default_compute_sa "${service_account}"; then
      echo "FAIL: ${service} uses default compute service account (${service_account})."
      failures=$((failures + 1))
    fi
  else
    if [ -n "${service_account}" ] && is_default_compute_sa "${service_account}"; then
      echo "WARN: ${service} uses default compute service account (${service_account})."
      warnings=$((warnings + 1))
    fi
  fi
done

if [ "${failures}" -gt 0 ]; then
  echo "Cloud Run security check failed (${failures} issue(s), ${warnings} warning(s))."
  exit 1
fi

echo "Cloud Run security check passed (${warnings} warning(s))."
