#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-asia-northeast1}"
SERVICE_NAME="${SERVICE_NAME:-reservation-system-api}"
IMAGE_NAME="${IMAGE_NAME:-reservation-system-api}"
TAG="${TAG:-manual-$(date +%Y%m%d-%H%M%S)}"

ENV_VARS="${ENV_VARS:-}"
SECRETS="${SECRETS:-}"
CLOUDSQL_CONNECTION="${CLOUDSQL_CONNECTION:-}"
VPC_CONNECTOR="${VPC_CONNECTOR:-}"
MEMORY="${MEMORY:-512Mi}"
CPU="${CPU:-1}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
MAX_INSTANCES="${MAX_INSTANCES:-3}"
CONCURRENCY="${CONCURRENCY:-80}"

if [ -z "${PROJECT_ID}" ]; then
  echo "PROJECT_ID is required"
  exit 1
fi

IMAGE="gcr.io/${PROJECT_ID}/${IMAGE_NAME}:${TAG}"

echo "Building and pushing image: ${IMAGE}"
gcloud config set project "${PROJECT_ID}"

pushd "$(dirname "$0")/.." >/dev/null
npm ci
npm run build
docker build -t "${IMAGE}" -f Dockerfile .
docker push "${IMAGE}"
popd >/dev/null

ENV_FLAGS=()
SECRET_FLAGS=()
CLOUDSQL_FLAGS=()
VPC_FLAGS=()

if [ -n "${ENV_VARS}" ]; then ENV_FLAGS=(--set-env-vars="${ENV_VARS}"); fi
if [ -n "${SECRETS}" ]; then SECRET_FLAGS=(--set-secrets="${SECRETS}"); fi
if [ -n "${CLOUDSQL_CONNECTION}" ]; then CLOUDSQL_FLAGS=(--add-cloudsql-instances="${CLOUDSQL_CONNECTION}"); fi
if [ -n "${VPC_CONNECTOR}" ]; then VPC_FLAGS=(--vpc-connector="${VPC_CONNECTOR}"); fi

echo "Deploying to Cloud Run: ${SERVICE_NAME}"
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --memory "${MEMORY}" \
  --cpu "${CPU}" \
  --min-instances "${MIN_INSTANCES}" \
  --max-instances "${MAX_INSTANCES}" \
  --concurrency "${CONCURRENCY}" \
  "${ENV_FLAGS[@]}" \
  "${SECRET_FLAGS[@]}" \
  "${CLOUDSQL_FLAGS[@]}" \
  "${VPC_FLAGS[@]}"

echo "Done."
