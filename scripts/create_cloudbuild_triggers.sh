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
FORCE_RECREATE="${FORCE_RECREATE:-false}"
CLOUDSQL_CONNECTION="${CLOUDSQL_CONNECTION:-}"
CLOUDSQL_INSTANCE="${CLOUDSQL_INSTANCE:-}"
DB_USER="${DB_USER:-app_user}"
DB_NAME="${DB_NAME:-reservation_system}"

if [ -z "${CLOUDSQL_CONNECTION}" ]; then
  echo "ERROR: CLOUDSQL_CONNECTION is required (example: project:asia-northeast1:reservation-system-db)"
  exit 1
fi

CB_REGION="${CB_REGION:-asia-northeast1}"
CB_CONNECTION="${CB_CONNECTION:-${TRIGGER_PREFIX}-conn}"
CB_REPOSITORY="${CB_REPOSITORY:-${GITHUB_REPO}}"
REMOTE_URI="${REMOTE_URI:-https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git}"

# Cloud Build GitHub triggers are increasingly moving to 2nd gen repos (cloudbuild/v2).
# For 2nd gen repos, you must:
# 1) Create a GitHub connection (one-time, opens a browser URL)
# 2) Register the GitHub repo in that connection
#
# This script assumes the connection/repository already exist and fails fast with
# copy-pastable commands if they don't.
if ! gcloud builds connections describe "${CB_CONNECTION}" --project="${PROJECT_ID}" --region="${CB_REGION}" >/dev/null 2>&1; then
  echo "ERROR: Cloud Build GitHub connection not found."
  echo ""
  echo "Create it (one-time; follow printed URLs):"
  echo "  gcloud builds connections create github ${CB_CONNECTION} --project=${PROJECT_ID} --region=${CB_REGION}"
  echo ""
  echo "Then register the repo:"
  echo "  gcloud builds repositories create ${CB_REPOSITORY} \\"
  echo "    --remote-uri=${REMOTE_URI} \\"
  echo "    --connection=${CB_CONNECTION} \\"
  echo "    --project=${PROJECT_ID} \\"
  echo "    --region=${CB_REGION}"
  exit 1
fi

if ! gcloud builds repositories describe "${CB_REPOSITORY}" --project="${PROJECT_ID}" --connection="${CB_CONNECTION}" --region="${CB_REGION}" >/dev/null 2>&1; then
  echo "ERROR: Cloud Build repository not found in the connection."
  echo ""
  echo "Create it (one-time):"
  echo "  gcloud builds repositories create ${CB_REPOSITORY} \\"
  echo "    --remote-uri=${REMOTE_URI} \\"
  echo "    --connection=${CB_CONNECTION} \\"
  echo "    --project=${PROJECT_ID} \\"
  echo "    --region=${CB_REGION}"
  exit 1
fi

REPOSITORY_RESOURCE="projects/${PROJECT_ID}/locations/${CB_REGION}/connections/${CB_CONNECTION}/repositories/${CB_REPOSITORY}"

TRIGGER_SERVICE_ACCOUNT="${TRIGGER_SERVICE_ACCOUNT:-}"
USE_TRIGGER_SERVICE_ACCOUNT="${USE_TRIGGER_SERVICE_ACCOUNT:-false}"

if [ "${USE_TRIGGER_SERVICE_ACCOUNT}" != "true" ]; then
  TRIGGER_SERVICE_ACCOUNT=""
fi

if [ -n "${TRIGGER_SERVICE_ACCOUNT}" ] && [[ "${TRIGGER_SERVICE_ACCOUNT}" =~ @cloudbuild\.gserviceaccount\.com$ ]]; then
  echo "ERROR: TRIGGER_SERVICE_ACCOUNT points to a Cloud Build-managed service account (${TRIGGER_SERVICE_ACCOUNT})."
  echo "Use a user-managed service account, or leave TRIGGER_SERVICE_ACCOUNT unset."
  exit 1
fi

if [ -n "${TRIGGER_SERVICE_ACCOUNT}" ]; then
  echo "INFO: Creating triggers with user-managed service account: ${TRIGGER_SERVICE_ACCOUNT}"
else
  echo "INFO: Creating triggers without explicit service account (Cloud Build default)."
fi

create_trigger_if_missing() {
  local trigger_name="$1"
  local included_files="$2"
  local substitutions="$3"

  local existing_id
  existing_id="$(gcloud builds triggers list \
    --project="${PROJECT_ID}" \
    --region="${CB_REGION}" \
    --format="csv[no-heading](id,name)" \
    | awk -F',' -v n="${trigger_name}" '$2==n {print $1; exit}' || true)"

  if [ -n "${existing_id}" ]; then
    if [ "${FORCE_RECREATE}" = "true" ]; then
      echo "RECREATE: deleting existing trigger (${trigger_name}, id=${existing_id})"
      gcloud builds triggers delete "${existing_id}" \
        --project="${PROJECT_ID}" \
        --region="${CB_REGION}" \
        --quiet
    else
      echo "SKIP: trigger already exists (${trigger_name}, id=${existing_id})"
      return
    fi
  fi

  if [ -n "${TRIGGER_SERVICE_ACCOUNT}" ]; then
    gcloud builds triggers create github \
      --project="${PROJECT_ID}" \
      --name="${trigger_name}" \
      --repository="${REPOSITORY_RESOURCE}" \
      --region="${CB_REGION}" \
      --branch-pattern="${BRANCH_PATTERN}" \
      --build-config="cloudbuild.yaml" \
      --included-files="${included_files}" \
      --substitutions="${substitutions}" \
      --service-account="${TRIGGER_SERVICE_ACCOUNT}"
  else
    gcloud builds triggers create github \
      --project="${PROJECT_ID}" \
      --name="${trigger_name}" \
      --repository="${REPOSITORY_RESOURCE}" \
      --region="${CB_REGION}" \
      --branch-pattern="${BRANCH_PATTERN}" \
      --build-config="cloudbuild.yaml" \
      --included-files="${included_files}" \
      --substitutions="${substitutions}"
  fi

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
