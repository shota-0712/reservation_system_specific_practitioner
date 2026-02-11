#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${GITHUB_OWNER:?GITHUB_OWNER is required}"
: "${GITHUB_REPO:?GITHUB_REPO is required}"
: "${NEXT_PUBLIC_API_URL:?NEXT_PUBLIC_API_URL is required}"
: "${NEXT_PUBLIC_ADMIN_URL:?NEXT_PUBLIC_ADMIN_URL is required}"
: "${NEXT_PUBLIC_FIREBASE_API_KEY:?NEXT_PUBLIC_FIREBASE_API_KEY is required}"
: "${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:?NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN is required}"
: "${NEXT_PUBLIC_FIREBASE_PROJECT_ID:?NEXT_PUBLIC_FIREBASE_PROJECT_ID is required}"
: "${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:?NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is required}"
: "${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:?NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID is required}"
: "${NEXT_PUBLIC_FIREBASE_APP_ID:?NEXT_PUBLIC_FIREBASE_APP_ID is required}"

BRANCH_PATTERN="${BRANCH_PATTERN:-^main$}"
TRIGGER_PREFIX="${TRIGGER_PREFIX:-reserve}"
CUSTOMER_TENANT_KEY="${CUSTOMER_TENANT_KEY:-default}"
NEXT_PUBLIC_TENANT_ID="${NEXT_PUBLIC_TENANT_ID:-${CUSTOMER_TENANT_KEY}}"
CUSTOMER_API_URL="${CUSTOMER_API_URL:-${NEXT_PUBLIC_API_URL}}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-false}"
RUN_INTEGRATION="${RUN_INTEGRATION:-false}"
WRITE_FREEZE_MODE="${WRITE_FREEZE_MODE:-false}"
CLOUDSQL_CONNECTION="${CLOUDSQL_CONNECTION:-}"
CLOUDSQL_INSTANCE="${CLOUDSQL_INSTANCE:-}"
DB_USER="${DB_USER:-app_user}"
DB_NAME="${DB_NAME:-reservation_system}"

if [ -z "${CLOUDSQL_CONNECTION}" ]; then
  echo "ERROR: CLOUDSQL_CONNECTION is required (example: project:asia-northeast1:reservation-system-db)"
  exit 1
fi

create_trigger_if_missing() {
  local trigger_name="$1"
  local included_files="$2"
  local substitutions="$3"

  local existing_id
  existing_id="$(gcloud builds triggers list \
    --project="${PROJECT_ID}" \
    --filter="name=${trigger_name}" \
    --format="value(id)" \
    | head -n1 || true)"

  if [ -n "${existing_id}" ]; then
    echo "SKIP: trigger already exists (${trigger_name}, id=${existing_id})"
    return
  fi

  gcloud builds triggers create github \
    --project="${PROJECT_ID}" \
    --name="${trigger_name}" \
    --repo-owner="${GITHUB_OWNER}" \
    --repo-name="${GITHUB_REPO}" \
    --branch-pattern="${BRANCH_PATTERN}" \
    --build-config="cloudbuild.yaml" \
    --included-files="${included_files}" \
    --substitutions="${substitutions}"

  echo "CREATED: ${trigger_name}"
}

backend_substitutions="_DEPLOY_TARGET=backend,_RUN_INTEGRATION=${RUN_INTEGRATION},_RUN_MIGRATIONS=${RUN_MIGRATIONS},_WRITE_FREEZE_MODE=${WRITE_FREEZE_MODE},_CLOUDSQL_CONNECTION=${CLOUDSQL_CONNECTION},_DB_USER=${DB_USER},_DB_NAME=${DB_NAME},_NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID}"
if [ -n "${CLOUDSQL_INSTANCE}" ]; then
  backend_substitutions="${backend_substitutions},_CLOUDSQL_INSTANCE=${CLOUDSQL_INSTANCE}"
fi

admin_substitutions="_DEPLOY_TARGET=admin,_NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL},_NEXT_PUBLIC_TENANT_ID=${NEXT_PUBLIC_TENANT_ID},_NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY},_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN},_NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID},_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET},_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID},_NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID}"
customer_substitutions="_DEPLOY_TARGET=customer,_CUSTOMER_API_URL=${CUSTOMER_API_URL},_CUSTOMER_TENANT_KEY=${CUSTOMER_TENANT_KEY}"
landing_substitutions="_DEPLOY_TARGET=landing,_NEXT_PUBLIC_ADMIN_URL=${NEXT_PUBLIC_ADMIN_URL}"

create_trigger_if_missing \
  "${TRIGGER_PREFIX}-backend" \
  "cloudbuild.yaml,backend-v2/**,database/**,scripts/run_migrations_cloudbuild.sh" \
  "${backend_substitutions}"

create_trigger_if_missing \
  "${TRIGGER_PREFIX}-admin" \
  "cloudbuild.yaml,admin-dashboard/**" \
  "${admin_substitutions}"

create_trigger_if_missing \
  "${TRIGGER_PREFIX}-customer" \
  "cloudbuild.yaml,customer-app/**" \
  "${customer_substitutions}"

create_trigger_if_missing \
  "${TRIGGER_PREFIX}-landing" \
  "cloudbuild.yaml,landing-page/**" \
  "${landing_substitutions}"

echo "DONE: Cloud Build triggers are configured."
