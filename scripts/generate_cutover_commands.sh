#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Generate a cutover command sheet with concrete project values.

Required env vars:
  PROJECT_ID
  NEXT_PUBLIC_API_URL
  NEXT_PUBLIC_ADMIN_URL
  NEXT_PUBLIC_FIREBASE_API_KEY
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
  NEXT_PUBLIC_FIREBASE_PROJECT_ID
  NEXT_PUBLIC_TENANT_ID
  CLOUDSQL_CONNECTION
  CLOUDSQL_INSTANCE

Optional env vars:
  REGION (default: asia-northeast1)
  API_SERVICE (default: reserve-api)
  ADMIN_SERVICE (default: reserve-admin)
  CUSTOMER_SERVICE (default: reserve-customer)
  LANDING_SERVICE (default: reserve-landing)
  CUSTOMER_API_URL (default: NEXT_PUBLIC_API_URL)
  CUSTOMER_TENANT_KEY (default: demo-salon)
  DB_USER (default: app_user)
  DB_NAME (default: reservation_system)
  JOB_LOCATION (default: asia-northeast1)
  JOB_NAMES (default: reminder-day-before,reminder-same-day,daily-analytics,google-calendar-sync)
  OLD_BACKEND_SERVICE (default: reserve-api-legacy)
  OLD_BACKEND_DOMAINS (optional)
  OLD_BACKEND_SECRET_NAMES (optional)
  OLD_BACKEND_SERVICE_ACCOUNT (optional)
  OUTPUT_PATH (default: docs/runbooks/CUTOVER_COMMANDS.generated.md)

Usage:
  PROJECT_ID=... \
  NEXT_PUBLIC_API_URL=https://reserve-api-xxxxx.run.app \
  NEXT_PUBLIC_ADMIN_URL=https://reserve-admin-xxxxx.run.app \
  NEXT_PUBLIC_FIREBASE_API_KEY=... \
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=... \
  NEXT_PUBLIC_FIREBASE_PROJECT_ID=... \
  NEXT_PUBLIC_TENANT_ID=demo-salon \
  CLOUDSQL_CONNECTION=PROJECT:asia-northeast1:reservation-system-db \
  CLOUDSQL_INSTANCE=reservation-system-db \
  ./scripts/generate_cutover_commands.sh
USAGE
}

if [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "${1:-}" != "" ]; then
  echo "ERROR: unknown argument '$1'"
  usage
  exit 1
fi

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${NEXT_PUBLIC_API_URL:?NEXT_PUBLIC_API_URL is required}"
: "${NEXT_PUBLIC_ADMIN_URL:?NEXT_PUBLIC_ADMIN_URL is required}"
: "${NEXT_PUBLIC_FIREBASE_API_KEY:?NEXT_PUBLIC_FIREBASE_API_KEY is required}"
: "${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:?NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN is required}"
: "${NEXT_PUBLIC_FIREBASE_PROJECT_ID:?NEXT_PUBLIC_FIREBASE_PROJECT_ID is required}"
: "${NEXT_PUBLIC_TENANT_ID:?NEXT_PUBLIC_TENANT_ID is required}"
: "${CLOUDSQL_CONNECTION:?CLOUDSQL_CONNECTION is required}"
: "${CLOUDSQL_INSTANCE:?CLOUDSQL_INSTANCE is required}"

REGION="${REGION:-asia-northeast1}"
API_SERVICE="${API_SERVICE:-reserve-api}"
ADMIN_SERVICE="${ADMIN_SERVICE:-reserve-admin}"
CUSTOMER_SERVICE="${CUSTOMER_SERVICE:-reserve-customer}"
LANDING_SERVICE="${LANDING_SERVICE:-reserve-landing}"
CUSTOMER_API_URL="${CUSTOMER_API_URL:-${NEXT_PUBLIC_API_URL}}"
CUSTOMER_TENANT_KEY="${CUSTOMER_TENANT_KEY:-${NEXT_PUBLIC_TENANT_ID}}"
NEXT_PUBLIC_TENANT_ID="${NEXT_PUBLIC_TENANT_ID}"
DB_USER="${DB_USER:-app_user}"
DB_NAME="${DB_NAME:-reservation_system}"
JOB_LOCATION="${JOB_LOCATION:-asia-northeast1}"
JOB_NAMES="${JOB_NAMES:-reminder-day-before,reminder-same-day,daily-analytics,google-calendar-sync}"
OLD_BACKEND_SERVICE="${OLD_BACKEND_SERVICE:-reserve-api-legacy}"
OLD_BACKEND_DOMAINS="${OLD_BACKEND_DOMAINS:-}"
OLD_BACKEND_SECRET_NAMES="${OLD_BACKEND_SECRET_NAMES:-}"
OLD_BACKEND_SERVICE_ACCOUNT="${OLD_BACKEND_SERVICE_ACCOUNT:-}"
OUTPUT_PATH="${OUTPUT_PATH:-docs/runbooks/CUTOVER_COMMANDS.generated.md}"

GENERATED_AT_UTC="$(date -u +"%Y-%m-%d %H:%M:%S UTC")"
mkdir -p "$(dirname "${OUTPUT_PATH}")"

cat > "${OUTPUT_PATH}" <<EOF
# Cutover Command Sheet

- Generated: ${GENERATED_AT_UTC}
- Project: \`${PROJECT_ID}\`
- Region: \`${REGION}\`

## 1) Export Variables

\`\`\`bash
export PROJECT_ID=${PROJECT_ID}
export REGION=${REGION}
export API_SERVICE=${API_SERVICE}
export ADMIN_SERVICE=${ADMIN_SERVICE}
export CUSTOMER_SERVICE=${CUSTOMER_SERVICE}
export LANDING_SERVICE=${LANDING_SERVICE}
export JOB_LOCATION=${JOB_LOCATION}
\`\`\`

## 2) Preflight

\`\`\`bash
gcloud config set project \${PROJECT_ID}
gcloud auth list
gcloud run services describe \${API_SERVICE} --region \${REGION}
gcloud run services describe \${ADMIN_SERVICE} --region \${REGION}
gcloud run services describe \${CUSTOMER_SERVICE} --region \${REGION}
\`\`\`

## 3) Freeze Writes + Pause Scheduler

\`\`\`bash
gcloud run services update \${API_SERVICE} \\
  --project \${PROJECT_ID} \\
  --region \${REGION} \\
  --update-env-vars=WRITE_FREEZE_MODE=true
\`\`\`

\`\`\`bash
gcloud scheduler jobs pause reminder-day-before --project \${PROJECT_ID} --location \${JOB_LOCATION}
gcloud scheduler jobs pause reminder-same-day --project \${PROJECT_ID} --location \${JOB_LOCATION}
gcloud scheduler jobs pause daily-analytics --project \${PROJECT_ID} --location \${JOB_LOCATION}
gcloud scheduler jobs pause google-calendar-sync --project \${PROJECT_ID} --location \${JOB_LOCATION}
\`\`\`

## 4) Deploy (Freeze On)

\`\`\`bash
gcloud builds submit . --config=cloudbuild.yaml \\
  --substitutions=_NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL},\\
_CUSTOMER_API_URL=${CUSTOMER_API_URL},\\
_CUSTOMER_TENANT_KEY=${CUSTOMER_TENANT_KEY},\\
_NEXT_PUBLIC_TENANT_ID=${NEXT_PUBLIC_TENANT_ID},\\
_NEXT_PUBLIC_ADMIN_URL=${NEXT_PUBLIC_ADMIN_URL},\\
_NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY},\\
_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN},\\
_NEXT_PUBLIC_FIREBASE_PROJECT_ID=${NEXT_PUBLIC_FIREBASE_PROJECT_ID},\\
_CLOUDSQL_CONNECTION=${CLOUDSQL_CONNECTION},\\
_RUN_INTEGRATION=true,\\
_RUN_MIGRATIONS=true,\\
_WRITE_FREEZE_MODE=true,\\
_CLOUDSQL_INSTANCE=${CLOUDSQL_INSTANCE},\\
_DB_USER=${DB_USER},\\
_DB_NAME=${DB_NAME}
\`\`\`

## 5) Smoke / Ready Checks

\`\`\`bash
curl -sS ${NEXT_PUBLIC_API_URL}/health
curl -sS ${NEXT_PUBLIC_API_URL}/ready
\`\`\`

## 6) Unfreeze + Resume Scheduler

\`\`\`bash
gcloud run services update \${API_SERVICE} \\
  --project \${PROJECT_ID} \\
  --region \${REGION} \\
  --update-env-vars=WRITE_FREEZE_MODE=false
\`\`\`

\`\`\`bash
gcloud scheduler jobs resume reminder-day-before --project \${PROJECT_ID} --location \${JOB_LOCATION}
gcloud scheduler jobs resume reminder-same-day --project \${PROJECT_ID} --location \${JOB_LOCATION}
gcloud scheduler jobs resume daily-analytics --project \${PROJECT_ID} --location \${JOB_LOCATION}
gcloud scheduler jobs resume google-calendar-sync --project \${PROJECT_ID} --location \${JOB_LOCATION}
\`\`\`

## 7) Rollback

Dry-run:
\`\`\`bash
PROJECT_ID=\${PROJECT_ID} REGION=\${REGION} API_SERVICE=\${API_SERVICE} ADMIN_SERVICE=\${ADMIN_SERVICE} CUSTOMER_SERVICE=\${CUSTOMER_SERVICE} JOB_LOCATION=\${JOB_LOCATION} JOB_NAMES=${JOB_NAMES} ./scripts/rollback_cutover.sh --resume-jobs
\`\`\`

Apply:
\`\`\`bash
PROJECT_ID=\${PROJECT_ID} REGION=\${REGION} API_SERVICE=\${API_SERVICE} ADMIN_SERVICE=\${ADMIN_SERVICE} CUSTOMER_SERVICE=\${CUSTOMER_SERVICE} JOB_LOCATION=\${JOB_LOCATION} JOB_NAMES=${JOB_NAMES} ./scripts/rollback_cutover.sh --apply --resume-jobs
\`\`\`

## 8) Decommission Legacy Backend

Dry-run:
\`\`\`bash
PROJECT_ID=\${PROJECT_ID} REGION=\${REGION} OLD_BACKEND_SERVICE=${OLD_BACKEND_SERVICE} OLD_BACKEND_DOMAINS=${OLD_BACKEND_DOMAINS} OLD_BACKEND_SECRET_NAMES=${OLD_BACKEND_SECRET_NAMES} OLD_BACKEND_SERVICE_ACCOUNT=${OLD_BACKEND_SERVICE_ACCOUNT} ./scripts/decommission_old_backend.sh
\`\`\`

Apply:
\`\`\`bash
PROJECT_ID=\${PROJECT_ID} REGION=\${REGION} OLD_BACKEND_SERVICE=${OLD_BACKEND_SERVICE} OLD_BACKEND_DOMAINS=${OLD_BACKEND_DOMAINS} OLD_BACKEND_SECRET_NAMES=${OLD_BACKEND_SECRET_NAMES} OLD_BACKEND_SERVICE_ACCOUNT=${OLD_BACKEND_SERVICE_ACCOUNT} ./scripts/decommission_old_backend.sh --apply
\`\`\`
EOF

echo "Generated cutover command sheet: ${OUTPUT_PATH}"
