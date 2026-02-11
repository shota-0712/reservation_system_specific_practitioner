#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID is required}"

CB_REGION="${CB_REGION:-asia-northeast1}"
TRIGGER_PREFIX="${TRIGGER_PREFIX:-reserve}"
EXPECT_BRANCH_PATTERN="${EXPECT_BRANCH_PATTERN:-^main$}"
EXPECT_TRIGGER_SERVICE_ACCOUNT="${EXPECT_TRIGGER_SERVICE_ACCOUNT:-}"
STRICT_SERVICE_ACCOUNT="${STRICT_SERVICE_ACCOUNT:-true}"
ALLOW_SERVICE_ACCOUNT_WITH_LOGGING="${ALLOW_SERVICE_ACCOUNT_WITH_LOGGING:-true}"
BUILD_CONFIG_PATH="${BUILD_CONFIG_PATH:-cloudbuild.yaml}"

# macOS default bash (3.2) does not support associative arrays.
trigger_specs=(
  "${TRIGGER_PREFIX}-backend:backend"
  "${TRIGGER_PREFIX}-admin:admin"
  "${TRIGGER_PREFIX}-customer:customer"
  "${TRIGGER_PREFIX}-landing:landing"
)

failures=0

service_account_logging_safe=false
if [ "${ALLOW_SERVICE_ACCOUNT_WITH_LOGGING}" = "true" ] && [ -f "${BUILD_CONFIG_PATH}" ]; then
  if grep -Eq '^[[:space:]]*logging:[[:space:]]*(CLOUD_LOGGING_ONLY|NONE)[[:space:]]*$' "${BUILD_CONFIG_PATH}" \
    || grep -Eq '^[[:space:]]*default_logs_bucket_behavior:[[:space:]]*REGIONAL_USER_OWNED_BUCKET[[:space:]]*$' "${BUILD_CONFIG_PATH}" \
    || grep -Eq '^[[:space:]]*logsBucket:[[:space:]]*' "${BUILD_CONFIG_PATH}"; then
    service_account_logging_safe=true
  fi
fi

for spec in "${trigger_specs[@]}"; do
  trigger_name="${spec%%:*}"
  expected_deploy_target="${spec#*:}"

  trigger_id="$(
    gcloud builds triggers list \
      --project "${PROJECT_ID}" \
      --region "${CB_REGION}" \
      --filter "name=${trigger_name}" \
      --format "value(id)" \
      | head -n 1
  )"

  if [ -z "${trigger_id}" ]; then
    echo "FAIL ${trigger_name}: trigger not found"
    failures=$((failures + 1))
    continue
  fi

  filename="$(gcloud builds triggers describe "${trigger_id}" --project "${PROJECT_ID}" --region "${CB_REGION}" --format "value(filename)" || true)"
  deploy_target="$(gcloud builds triggers describe "${trigger_id}" --project "${PROJECT_ID}" --region "${CB_REGION}" --format "value(substitutions._DEPLOY_TARGET)" || true)"
  service_account="$(gcloud builds triggers describe "${trigger_id}" --project "${PROJECT_ID}" --region "${CB_REGION}" --format "value(serviceAccount)" || true)"
  branch_pattern="$(gcloud builds triggers describe "${trigger_id}" --project "${PROJECT_ID}" --region "${CB_REGION}" --format "value(github.push.branch)" || true)"
  if [ -z "${branch_pattern}" ]; then
    branch_pattern="$(gcloud builds triggers describe "${trigger_id}" --project "${PROJECT_ID}" --region "${CB_REGION}" --format "value(repositoryEventConfig.push.branch)" || true)"
  fi

  item_failed=false

  if [ "${filename}" != "cloudbuild.yaml" ]; then
    echo "FAIL ${trigger_name}: filename=${filename:-<empty>} (expected cloudbuild.yaml)"
    item_failed=true
  fi

  if [ "${deploy_target}" != "${expected_deploy_target}" ]; then
    echo "FAIL ${trigger_name}: _DEPLOY_TARGET=${deploy_target:-<empty>} (expected ${expected_deploy_target})"
    item_failed=true
  fi

  if [ -n "${EXPECT_BRANCH_PATTERN}" ] && [ "${branch_pattern}" != "${EXPECT_BRANCH_PATTERN}" ]; then
    echo "FAIL ${trigger_name}: branch-pattern=${branch_pattern:-<empty>} (expected ${EXPECT_BRANCH_PATTERN})"
    item_failed=true
  fi

  if [ -n "${EXPECT_TRIGGER_SERVICE_ACCOUNT}" ]; then
    if [ "${service_account}" != "${EXPECT_TRIGGER_SERVICE_ACCOUNT}" ]; then
      echo "FAIL ${trigger_name}: serviceAccount=${service_account:-<empty>} (expected ${EXPECT_TRIGGER_SERVICE_ACCOUNT})"
      item_failed=true
    fi
  else
    if [ -n "${service_account}" ] && [ "${STRICT_SERVICE_ACCOUNT}" = "true" ]; then
      if [ "${service_account_logging_safe}" = "true" ]; then
        echo "WARN ${trigger_name}: serviceAccount is set, but ${BUILD_CONFIG_PATH} has SA-compatible logging."
      else
        echo "FAIL ${trigger_name}: serviceAccount=${service_account} is set."
        echo "     This often causes 'build.service_account + logs bucket/logging' run failures."
        echo "     Recreate trigger without service account or set logs bucket/logging policy explicitly."
        item_failed=true
      fi
    fi
  fi

  if [ "${item_failed}" = true ]; then
    failures=$((failures + 1))
  else
    echo "OK   ${trigger_name}: id=${trigger_id} branch=${branch_pattern} target=${deploy_target}"
  fi
done

if [ "${failures}" -gt 0 ]; then
  echo "Trigger health check failed (${failures} issue(s))."
  exit 1
fi

echo "Trigger health check passed."
