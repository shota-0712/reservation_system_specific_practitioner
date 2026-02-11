#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Decommission legacy backend resources on GCP.

Default mode is dry-run. Use --apply to execute commands.

Required env vars:
  PROJECT_ID
  REGION
  OLD_BACKEND_SERVICE

Optional env vars:
  OLD_BACKEND_DOMAINS
    Comma-separated domain mapping list for old backend
    (example: api-old.example.com,legacy-api.example.com)
  OLD_BACKEND_SECRET_NAMES
    Comma-separated secret names to disable
    (example: old-db-password,old-line-token)
  OLD_BACKEND_SECRET_VERSION
    Secret version to disable (default: latest enabled version)
  OLD_BACKEND_SERVICE_ACCOUNT
    Service account email to disable

Usage:
  PROJECT_ID=... REGION=asia-northeast1 OLD_BACKEND_SERVICE=reserve-api-old \
    ./scripts/decommission_old_backend.sh

  PROJECT_ID=... REGION=asia-northeast1 OLD_BACKEND_SERVICE=reserve-api-old \
    OLD_BACKEND_DOMAINS=api-old.example.com \
    OLD_BACKEND_SECRET_NAMES=old-db-password,old-line-token \
    OLD_BACKEND_SERVICE_ACCOUNT=old-backend-sa@PROJECT_ID.iam.gserviceaccount.com \
    ./scripts/decommission_old_backend.sh --apply
USAGE
}

APPLY=false
if [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi
if [ "${1:-}" = "--apply" ]; then
  APPLY=true
fi
if [ "${1:-}" != "" ] && [ "${1:-}" != "--apply" ]; then
  echo "ERROR: unknown argument '${1}'"
  usage
  exit 1
fi

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${REGION:?REGION is required}"
: "${OLD_BACKEND_SERVICE:?OLD_BACKEND_SERVICE is required}"

OLD_BACKEND_DOMAINS="${OLD_BACKEND_DOMAINS:-}"
OLD_BACKEND_SECRET_NAMES="${OLD_BACKEND_SECRET_NAMES:-}"
OLD_BACKEND_SECRET_VERSION="${OLD_BACKEND_SECRET_VERSION:-}"
OLD_BACKEND_SERVICE_ACCOUNT="${OLD_BACKEND_SERVICE_ACCOUNT:-}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud command not found"
  exit 1
fi

run_cmd() {
  if [ "${APPLY}" = "true" ]; then
    "$@"
    return
  fi

  printf "[dry-run]"
  printf " %q" "$@"
  printf "\n"
}

resource_exists() {
  local kind="$1"
  local identifier="$2"

  case "${kind}" in
    run-service)
      gcloud run services describe "${identifier}" \
        --project "${PROJECT_ID}" \
        --region "${REGION}" \
        --format="value(metadata.name)" >/dev/null 2>&1
      ;;
    domain-mapping)
      gcloud run domain-mappings list \
        --project "${PROJECT_ID}" \
        --region "${REGION}" \
        --format="value(metadata.name)" \
        --filter="metadata.name=${identifier}" \
        | grep -q .
      ;;
    secret)
      gcloud secrets describe "${identifier}" \
        --project "${PROJECT_ID}" \
        --format="value(name)" >/dev/null 2>&1
      ;;
    service-account)
      gcloud iam service-accounts describe "${identifier}" \
        --project "${PROJECT_ID}" \
        --format="value(email)" >/dev/null 2>&1
      ;;
    *)
      echo "ERROR: unknown resource kind '${kind}'" >&2
      exit 1
      ;;
  esac
}

disable_secret_version() {
  local secret_name="$1"
  local version="${OLD_BACKEND_SECRET_VERSION}"

  if ! resource_exists "secret" "${secret_name}"; then
    echo "SKIP: secret not found (${secret_name})"
    return
  fi

  if [ -z "${version}" ]; then
    version="$(
      gcloud secrets versions list "${secret_name}" \
        --project "${PROJECT_ID}" \
        --filter="state=enabled" \
        --sort-by="~createTime" \
        --limit=1 \
        --format="value(name.basename())"
    )"
  fi

  if [ -z "${version}" ]; then
    echo "SKIP: no enabled secret versions (${secret_name})"
    return
  fi

  echo "Disable secret version: ${secret_name}:${version}"
  run_cmd gcloud secrets versions disable "${version}" \
    --project "${PROJECT_ID}" \
    --secret "${secret_name}"
}

echo "Step 1: decommission legacy Cloud Run service"
if resource_exists "run-service" "${OLD_BACKEND_SERVICE}"; then
  run_cmd gcloud run services delete "${OLD_BACKEND_SERVICE}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --quiet
else
  echo "SKIP: old backend service not found (${OLD_BACKEND_SERVICE})"
fi

echo "Step 2: remove legacy domain mappings (optional)"
if [ -n "${OLD_BACKEND_DOMAINS}" ]; then
  IFS=',' read -r -a domain_array <<< "${OLD_BACKEND_DOMAINS}"
  for domain in "${domain_array[@]}"; do
    domain="$(echo "${domain}" | xargs)"
    if [ -z "${domain}" ]; then
      continue
    fi

    if resource_exists "domain-mapping" "${domain}"; then
      run_cmd gcloud run domain-mappings delete \
        --project "${PROJECT_ID}" \
        --region "${REGION}" \
        --domain "${domain}" \
        --quiet
    else
      echo "SKIP: domain mapping not found (${domain})"
    fi
  done
else
  echo "SKIP: OLD_BACKEND_DOMAINS is empty"
fi

echo "Step 3: disable legacy secrets (optional)"
if [ -n "${OLD_BACKEND_SECRET_NAMES}" ]; then
  IFS=',' read -r -a secret_array <<< "${OLD_BACKEND_SECRET_NAMES}"
  for secret_name in "${secret_array[@]}"; do
    secret_name="$(echo "${secret_name}" | xargs)"
    if [ -z "${secret_name}" ]; then
      continue
    fi
    disable_secret_version "${secret_name}"
  done
else
  echo "SKIP: OLD_BACKEND_SECRET_NAMES is empty"
fi

echo "Step 4: disable legacy service account (optional)"
if [ -n "${OLD_BACKEND_SERVICE_ACCOUNT}" ]; then
  if resource_exists "service-account" "${OLD_BACKEND_SERVICE_ACCOUNT}"; then
    run_cmd gcloud iam service-accounts disable "${OLD_BACKEND_SERVICE_ACCOUNT}" \
      --project "${PROJECT_ID}"
  else
    echo "SKIP: service account not found (${OLD_BACKEND_SERVICE_ACCOUNT})"
  fi
else
  echo "SKIP: OLD_BACKEND_SERVICE_ACCOUNT is empty"
fi

if [ "${APPLY}" = "true" ]; then
  echo "Decommission applied."
else
  echo "Dry-run complete. Re-run with --apply to execute decommission."
fi

