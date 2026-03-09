#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID is required}"

REGION="${REGION:-asia-northeast1}"
BACKEND_TRIGGER_NAME="${BACKEND_TRIGGER_NAME:-reserve-backend}"
API_SERVICE="${API_SERVICE:-reserve-api}"

error() {
  echo "FAIL: $*" >&2
  exit 1
}

info() {
  echo "INFO: $*"
}

trigger_sa_resource="$(
  gcloud builds triggers describe "${BACKEND_TRIGGER_NAME}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --format='value(serviceAccount)'
)"

if [ -z "${trigger_sa_resource}" ]; then
  error "trigger '${BACKEND_TRIGGER_NAME}' の serviceAccount を取得できませんでした。"
fi

trigger_sa="${trigger_sa_resource##*/}"
if [ -z "${trigger_sa}" ]; then
  error "trigger serviceAccount の正規化に失敗しました: ${trigger_sa_resource}"
fi

runtime_sa_resource="$(
  gcloud run services describe "${API_SERVICE}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --format='value(spec.template.spec.serviceAccountName)'
)"

if [ -z "${runtime_sa_resource}" ]; then
  error "Cloud Run service '${API_SERVICE}' の runtime service account を取得できませんでした。"
fi

runtime_sa="${runtime_sa_resource##*/}"
if [ -z "${runtime_sa}" ]; then
  error "runtime service account の正規化に失敗しました: ${runtime_sa_resource}"
fi

binding="$(
  gcloud iam service-accounts get-iam-policy "${runtime_sa}" \
    --project "${PROJECT_ID}" \
    --flatten='bindings[].members' \
    --filter="bindings.role:roles/iam.serviceAccountUser AND bindings.members:serviceAccount:${trigger_sa}" \
    --format='value(bindings.members)'
)"

info "project=${PROJECT_ID}"
info "region=${REGION}"
info "backend_trigger=${BACKEND_TRIGGER_NAME}"
info "trigger_service_account=${trigger_sa}"
info "runtime_service=${API_SERVICE}"
info "runtime_service_account=${runtime_sa}"

if [ -z "${binding}" ]; then
  echo "FAIL: backend deploy に必要な IAM が不足しています。" >&2
  echo "      missing role: roles/iam.serviceAccountUser" >&2
  echo "      target SA   : ${runtime_sa}" >&2
  echo "      member      : serviceAccount:${trigger_sa}" >&2
  echo >&2
  echo "以下を実行してください:" >&2
  echo "gcloud iam service-accounts add-iam-policy-binding ${runtime_sa} \\" >&2
  echo "  --project ${PROJECT_ID} \\" >&2
  echo "  --member=\"serviceAccount:${trigger_sa}\" \\" >&2
  echo "  --role=\"roles/iam.serviceAccountUser\"" >&2
  exit 1
fi

echo "OK: roles/iam.serviceAccountUser binding is configured."
