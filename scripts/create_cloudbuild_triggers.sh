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
CB_REGION="${CB_REGION:-asia-northeast1}"
CB_CONNECTION="${CB_CONNECTION:-${TRIGGER_PREFIX}-conn}"
CB_REPOSITORY="${CB_REPOSITORY:-${GITHUB_REPO}}"
REMOTE_URI="${REMOTE_URI:-https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git}"

CUSTOMER_TENANT_KEY="${CUSTOMER_TENANT_KEY:-default}"
NEXT_PUBLIC_TENANT_ID="${NEXT_PUBLIC_TENANT_ID:-${CUSTOMER_TENANT_KEY}}"
CUSTOMER_API_URL="${CUSTOMER_API_URL:-${NEXT_PUBLIC_API_URL}}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-false}"
RUN_INTEGRATION="${RUN_INTEGRATION:-false}"
WRITE_FREEZE_MODE="${WRITE_FREEZE_MODE:-false}"
READINESS_REQUIRE_LINE="${READINESS_REQUIRE_LINE:-false}"
READINESS_REQUIRE_GOOGLE_OAUTH="${READINESS_REQUIRE_GOOGLE_OAUTH:-true}"
PUBLIC_ONBOARDING_ENABLED="${PUBLIC_ONBOARDING_ENABLED:-true}"
FORCE_RECREATE="${FORCE_RECREATE:-false}"
AUTO_RECREATE_ON_UPDATE_CONFLICT="${AUTO_RECREATE_ON_UPDATE_CONFLICT:-true}"

CLOUDSQL_CONNECTION="${CLOUDSQL_CONNECTION:-}"
CLOUDSQL_INSTANCE="${CLOUDSQL_INSTANCE:-}"
DB_USER="${DB_USER:-app_user}"
DB_NAME="${DB_NAME:-reservation_system}"
GOOGLE_OAUTH_CLIENT_ID="${GOOGLE_OAUTH_CLIENT_ID:-}"
GOOGLE_OAUTH_REDIRECT_URI="${GOOGLE_OAUTH_REDIRECT_URI:-}"

TRIGGER_SERVICE_ACCOUNT="${TRIGGER_SERVICE_ACCOUNT:-}"
USE_TRIGGER_SERVICE_ACCOUNT="${USE_TRIGGER_SERVICE_ACCOUNT:-false}"
if [ "${USE_TRIGGER_SERVICE_ACCOUNT}" != "true" ]; then
  TRIGGER_SERVICE_ACCOUNT=""
fi

if [ -z "${CLOUDSQL_CONNECTION}" ]; then
  echo "ERROR: CLOUDSQL_CONNECTION is required (example: project:asia-northeast1:reservation-system-db)"
  exit 1
fi

if [ -n "${GOOGLE_OAUTH_CLIENT_ID}" ] && [ -z "${GOOGLE_OAUTH_REDIRECT_URI}" ]; then
  echo "ERROR: GOOGLE_OAUTH_REDIRECT_URI is required when GOOGLE_OAUTH_CLIENT_ID is set."
  exit 1
fi

if [ -z "${GOOGLE_OAUTH_CLIENT_ID}" ] && [ -n "${GOOGLE_OAUTH_REDIRECT_URI}" ]; then
  echo "ERROR: GOOGLE_OAUTH_CLIENT_ID is required when GOOGLE_OAUTH_REDIRECT_URI is set."
  exit 1
fi

if [ "${READINESS_REQUIRE_GOOGLE_OAUTH}" = "true" ] && { [ -z "${GOOGLE_OAUTH_CLIENT_ID}" ] || [ -z "${GOOGLE_OAUTH_REDIRECT_URI}" ]; }; then
  echo "ERROR: READINESS_REQUIRE_GOOGLE_OAUTH=true requires GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_REDIRECT_URI."
  exit 1
fi

if [ -n "${TRIGGER_SERVICE_ACCOUNT}" ] && [[ "${TRIGGER_SERVICE_ACCOUNT}" =~ @cloudbuild\.gserviceaccount\.com$ ]]; then
  echo "ERROR: TRIGGER_SERVICE_ACCOUNT points to a Cloud Build-managed service account (${TRIGGER_SERVICE_ACCOUNT})."
  echo "Use a user-managed service account, or leave TRIGGER_SERVICE_ACCOUNT unset."
  exit 1
fi

if ! gcloud builds connections describe "${CB_CONNECTION}" --project="${PROJECT_ID}" --region="${CB_REGION}" >/dev/null 2>&1; then
  cat <<EOF
ERROR: Cloud Build GitHub connection not found.

Create it (one-time; follow printed URLs):
  gcloud builds connections create github ${CB_CONNECTION} --project=${PROJECT_ID} --region=${CB_REGION}

Then register the repo:
  gcloud builds repositories create ${CB_REPOSITORY} \\
    --remote-uri=${REMOTE_URI} \\
    --connection=${CB_CONNECTION} \\
    --project=${PROJECT_ID} \\
    --region=${CB_REGION}
EOF
  exit 1
fi

if ! gcloud builds repositories describe "${CB_REPOSITORY}" --project="${PROJECT_ID}" --connection="${CB_CONNECTION}" --region="${CB_REGION}" >/dev/null 2>&1; then
  # Fallback: resolve repository by remote URI if ID differs (e.g. "_" vs "-").
  detected_repo="$(
    gcloud builds repositories list \
      --project="${PROJECT_ID}" \
      --connection="${CB_CONNECTION}" \
      --region="${CB_REGION}" \
      --format="csv[no-heading](name,remoteUri)" \
      | awk -F',' -v remote="${REMOTE_URI}" '$2==remote {print $1; exit}'
  )"
  if [ -n "${detected_repo}" ]; then
    detected_repo="${detected_repo##*/}"
    echo "INFO: repository '${CB_REPOSITORY}' not found; using '${detected_repo}' matched by remote URI."
    CB_REPOSITORY="${detected_repo}"
  fi
fi

if ! gcloud builds repositories describe "${CB_REPOSITORY}" --project="${PROJECT_ID}" --connection="${CB_CONNECTION}" --region="${CB_REGION}" >/dev/null 2>&1; then
  cat <<EOF
ERROR: Cloud Build repository not found in the connection.

Create it (one-time):
  gcloud builds repositories create ${CB_REPOSITORY} \\
    --remote-uri=${REMOTE_URI} \\
    --connection=${CB_CONNECTION} \\
    --project=${PROJECT_ID} \\
    --region=${CB_REGION}
EOF
  exit 1
fi

REPOSITORY_RESOURCE="projects/${PROJECT_ID}/locations/${CB_REGION}/connections/${CB_CONNECTION}/repositories/${CB_REPOSITORY}"

if [ -n "${TRIGGER_SERVICE_ACCOUNT}" ]; then
  echo "INFO: trigger service account: ${TRIGGER_SERVICE_ACCOUNT}"
else
  echo "INFO: trigger service account: (Cloud Build default)"
fi

trigger_id_by_name() {
  local trigger_name="$1"
  gcloud builds triggers list \
    --project="${PROJECT_ID}" \
    --region="${CB_REGION}" \
    --format="csv[no-heading](id,name)" \
    | awk -F',' -v n="${trigger_name}" '$2==n {print $1; exit}'
}

create_trigger() {
  local trigger_name="$1"
  local included_files="$2"
  local substitutions="$3"

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
}

probe_trigger_create() {
  local base_name="$1"
  local included_files="$2"
  local substitutions="$3"
  local probe_name="${base_name}-probe-$(date +%s)"
  local probe_id=""

  if ! create_trigger "${probe_name}" "${included_files}" "${substitutions}"; then
    return 1
  fi

  probe_id="$(trigger_id_by_name "${probe_name}" || true)"
  if [ -n "${probe_id}" ]; then
    gcloud builds triggers delete "${probe_id}" --project="${PROJECT_ID}" --region="${CB_REGION}" --quiet >/dev/null
  fi
}

update_trigger() {
  local trigger_name="$1"
  local trigger_id="$2"
  local included_files="$3"
  local substitutions="$4"

  local args=(
    builds triggers update github "${trigger_id}"
    --project="${PROJECT_ID}"
    --region="${CB_REGION}"
    --repository="${REPOSITORY_RESOURCE}"
    --branch-pattern="${BRANCH_PATTERN}"
    --build-config="cloudbuild.yaml"
    --included-files="${included_files}"
    --update-substitutions="${substitutions}"
  )

  if [ -n "${TRIGGER_SERVICE_ACCOUNT}" ]; then
    args+=(--service-account="${TRIGGER_SERVICE_ACCOUNT}")
  fi

  local output=""
  if output="$(gcloud "${args[@]}" 2>&1)"; then
    echo "UPDATED: ${trigger_name}"
    return 0
  fi

  if echo "${output}" | grep -q "cannot set more than one trigger config"; then
    echo "WARN: update conflict for ${trigger_name} (cannot set more than one trigger config)."
    return 20
  fi

  echo "${output}" >&2
  return 1
}

ensure_trigger() {
  local trigger_name="$1"
  local included_files="$2"
  local substitutions="$3"

  local existing_id
  existing_id="$(trigger_id_by_name "${trigger_name}" || true)"

  if [ -z "${existing_id}" ]; then
    create_trigger "${trigger_name}" "${included_files}" "${substitutions}"
    echo "CREATED: ${trigger_name}"
    return
  fi

  local existing_service_account
  existing_service_account="$(gcloud builds triggers describe "${existing_id}" --project="${PROJECT_ID}" --region="${CB_REGION}" --format='value(serviceAccount)' || true)"

  # serviceAccount を外したい場合は update で clear できないため recreate が必要
  if [ -z "${TRIGGER_SERVICE_ACCOUNT}" ] && [ -n "${existing_service_account}" ] && [ "${FORCE_RECREATE}" != "true" ]; then
    cat <<EOF
ERROR: Trigger ${trigger_name} has service_account=${existing_service_account}.
This causes run failures unless logs bucket/logging settings match.
Run again with FORCE_RECREATE=true to recreate trigger without service account.
EOF
    exit 1
  fi

  if [ "${FORCE_RECREATE}" = "true" ]; then
    echo "RECREATE: preflight create (${trigger_name})"
    if ! probe_trigger_create "${trigger_name}" "${included_files}" "${substitutions}"; then
      echo "ERROR: preflight create failed for ${trigger_name}. Existing trigger is kept unchanged."
      exit 1
    fi

    echo "RECREATE: deleting existing trigger (${trigger_name}, id=${existing_id})"
    gcloud builds triggers delete "${existing_id}" --project="${PROJECT_ID}" --region="${CB_REGION}" --quiet
    create_trigger "${trigger_name}" "${included_files}" "${substitutions}"
    echo "RECREATED: ${trigger_name}"
    return
  fi

  set +e
  update_trigger "${trigger_name}" "${existing_id}" "${included_files}" "${substitutions}"
  update_status=$?
  set -e

  if [ "${update_status}" -eq 0 ]; then
    return
  fi

  if [ "${update_status}" -eq 20 ]; then
    if [ "${AUTO_RECREATE_ON_UPDATE_CONFLICT}" = "true" ]; then
      echo "RECREATE: fallback due update conflict (${trigger_name})"
      if ! probe_trigger_create "${trigger_name}" "${included_files}" "${substitutions}"; then
        echo "ERROR: preflight create failed for ${trigger_name}. Existing trigger is kept unchanged."
        exit 1
      fi
      gcloud builds triggers delete "${existing_id}" --project="${PROJECT_ID}" --region="${CB_REGION}" --quiet
      create_trigger "${trigger_name}" "${included_files}" "${substitutions}"
      echo "RECREATED: ${trigger_name}"
      return
    fi

    echo "WARN: kept existing trigger unchanged for ${trigger_name} (AUTO_RECREATE_ON_UPDATE_CONFLICT=false)."
    return
  fi

  exit "${update_status}"
}

backend_substitutions="_DEPLOY_TARGET=backend,_RUN_INTEGRATION=${RUN_INTEGRATION},_RUN_MIGRATIONS=${RUN_MIGRATIONS},_WRITE_FREEZE_MODE=${WRITE_FREEZE_MODE},_CLOUDSQL_CONNECTION=${CLOUDSQL_CONNECTION},_DB_USER=${DB_USER},_DB_NAME=${DB_NAME},_NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID},_READINESS_REQUIRE_LINE=${READINESS_REQUIRE_LINE},_READINESS_REQUIRE_GOOGLE_OAUTH=${READINESS_REQUIRE_GOOGLE_OAUTH},_PUBLIC_ONBOARDING_ENABLED=${PUBLIC_ONBOARDING_ENABLED}"
if [ -n "${CLOUDSQL_INSTANCE}" ]; then
  backend_substitutions="${backend_substitutions},_CLOUDSQL_INSTANCE=${CLOUDSQL_INSTANCE}"
fi
if [ -n "${GOOGLE_OAUTH_CLIENT_ID}" ]; then
  backend_substitutions="${backend_substitutions},_GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID},_GOOGLE_OAUTH_REDIRECT_URI=${GOOGLE_OAUTH_REDIRECT_URI}"
fi

admin_substitutions="_DEPLOY_TARGET=admin,_NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL},_NEXT_PUBLIC_TENANT_ID=${NEXT_PUBLIC_TENANT_ID},_NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY},_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN},_NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID},_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET},_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID},_NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID}"
customer_substitutions="_DEPLOY_TARGET=customer,_CUSTOMER_API_URL=${CUSTOMER_API_URL},_CUSTOMER_TENANT_KEY=${CUSTOMER_TENANT_KEY}"
landing_substitutions="_DEPLOY_TARGET=landing,_NEXT_PUBLIC_ADMIN_URL=${NEXT_PUBLIC_ADMIN_URL}"

ensure_trigger \
  "${TRIGGER_PREFIX}-backend" \
  "cloudbuild.yaml,backend-v2/**,database/**,scripts/run_migrations_cloudbuild.sh" \
  "${backend_substitutions}"

ensure_trigger \
  "${TRIGGER_PREFIX}-admin" \
  "cloudbuild.yaml,admin-dashboard/**" \
  "${admin_substitutions}"

ensure_trigger \
  "${TRIGGER_PREFIX}-customer" \
  "cloudbuild.yaml,customer-app/**" \
  "${customer_substitutions}"

ensure_trigger \
  "${TRIGGER_PREFIX}-landing" \
  "cloudbuild.yaml,landing-page/**" \
  "${landing_substitutions}"

echo "DONE: Cloud Build triggers are configured."

if [ -x "./scripts/check_cloudbuild_triggers.sh" ]; then
  echo "INFO: running trigger health check..."
  PROJECT_ID="${PROJECT_ID}" \
  CB_REGION="${CB_REGION}" \
  TRIGGER_PREFIX="${TRIGGER_PREFIX}" \
  EXPECT_BRANCH_PATTERN="${BRANCH_PATTERN}" \
  EXPECT_TRIGGER_SERVICE_ACCOUNT="${TRIGGER_SERVICE_ACCOUNT}" \
  ./scripts/check_cloudbuild_triggers.sh
fi
