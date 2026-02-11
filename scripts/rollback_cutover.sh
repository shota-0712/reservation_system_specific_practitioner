#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Rollback Cloud Run services to previous stable revisions.

Required env vars:
  PROJECT_ID
  REGION
  API_SERVICE
  ADMIN_SERVICE
  CUSTOMER_SERVICE

Optional env vars:
  STABLE_API_REVISION
  STABLE_ADMIN_REVISION
  STABLE_CUSTOMER_REVISION
  JOB_LOCATION (default: asia-northeast1)
  JOB_NAMES (default: reminder-day-before,reminder-same-day,daily-analytics)

Usage:
  # dry-run (default)
  PROJECT_ID=... REGION=asia-northeast1 API_SERVICE=reserve-api ADMIN_SERVICE=reserve-admin CUSTOMER_SERVICE=reserve-customer \
    ./scripts/rollback_cutover.sh

  # apply rollback
  PROJECT_ID=... REGION=asia-northeast1 API_SERVICE=reserve-api ADMIN_SERVICE=reserve-admin CUSTOMER_SERVICE=reserve-customer \
    ./scripts/rollback_cutover.sh --apply

  # apply rollback + resume scheduler jobs
  PROJECT_ID=... REGION=asia-northeast1 API_SERVICE=reserve-api ADMIN_SERVICE=reserve-admin CUSTOMER_SERVICE=reserve-customer \
    JOB_LOCATION=asia-northeast1 \
    ./scripts/rollback_cutover.sh --apply --resume-jobs
USAGE
}

APPLY=false
RESUME_JOBS=false
JOB_LOCATION="${JOB_LOCATION:-asia-northeast1}"
JOB_NAMES="${JOB_NAMES:-reminder-day-before,reminder-same-day,daily-analytics}"

while [ $# -gt 0 ]; do
  case "$1" in
    --apply)
      APPLY=true
      shift
      ;;
    --resume-jobs)
      RESUME_JOBS=true
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument '$1'"
      usage
      exit 1
      ;;
  esac
done

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${REGION:?REGION is required}"
: "${API_SERVICE:?API_SERVICE is required}"
: "${ADMIN_SERVICE:?ADMIN_SERVICE is required}"
: "${CUSTOMER_SERVICE:?CUSTOMER_SERVICE is required}"

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

scheduler_job_exists() {
  local job_name="$1"
  gcloud scheduler jobs describe "${job_name}" \
    --project "${PROJECT_ID}" \
    --location "${JOB_LOCATION}" \
    --format="value(name)" >/dev/null 2>&1
}

detect_previous_revision() {
  local service="$1"
  local latest_ready revisions target

  latest_ready="$(
    gcloud run services describe "${service}" \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --format="value(status.latestReadyRevisionName)"
  )"

  mapfile -t revisions < <(
    gcloud run revisions list \
      --project "${PROJECT_ID}" \
      --region "${REGION}" \
      --service "${service}" \
      --sort-by="~createTime" \
      --limit=10 \
      --format="value(metadata.name)"
  )

  target=""
  for revision in "${revisions[@]}"; do
    if [ -n "${revision}" ] && [ "${revision}" != "${latest_ready}" ]; then
      target="${revision}"
      break
    fi
  done

  if [ -z "${target}" ]; then
    echo "ERROR: could not detect rollback revision for service '${service}'" >&2
    echo "       set STABLE_*_REVISION explicitly and retry." >&2
    exit 1
  fi

  printf "%s" "${target}"
}

select_revision() {
  local service="$1"
  local explicit="${2:-}"

  if [ -n "${explicit}" ]; then
    printf "%s" "${explicit}"
    return
  fi

  detect_previous_revision "${service}"
}

rollback_service() {
  local service="$1"
  local revision="$2"

  echo "Rollback target: service=${service}, revision=${revision}"
  run_cmd gcloud run services update-traffic "${service}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --to-revisions "${revision}=100"
}

api_revision="$(select_revision "${API_SERVICE}" "${STABLE_API_REVISION:-}")"
admin_revision="$(select_revision "${ADMIN_SERVICE}" "${STABLE_ADMIN_REVISION:-}")"
customer_revision="$(select_revision "${CUSTOMER_SERVICE}" "${STABLE_CUSTOMER_REVISION:-}")"

rollback_service "${API_SERVICE}" "${api_revision}"
rollback_service "${ADMIN_SERVICE}" "${admin_revision}"
rollback_service "${CUSTOMER_SERVICE}" "${customer_revision}"

if [ "${RESUME_JOBS}" = "true" ]; then
  IFS=',' read -r -a jobs <<< "${JOB_NAMES}"
  for job in "${jobs[@]}"; do
    job="$(echo "${job}" | xargs)"
    if [ -z "${job}" ]; then
      continue
    fi

    if scheduler_job_exists "${job}"; then
      echo "Resume scheduler job: ${job}"
      run_cmd gcloud scheduler jobs resume "${job}" \
        --project "${PROJECT_ID}" \
        --location "${JOB_LOCATION}"
    else
      echo "SKIP: scheduler job not found (${job})"
    fi
  done
fi

if [ "${APPLY}" = "true" ]; then
  echo "Rollback applied. Verify with:"
  echo "  gcloud run services describe ${API_SERVICE} --project ${PROJECT_ID} --region ${REGION} --format='value(status.traffic)'"
  echo "  gcloud run services describe ${ADMIN_SERVICE} --project ${PROJECT_ID} --region ${REGION} --format='value(status.traffic)'"
  echo "  gcloud run services describe ${CUSTOMER_SERVICE} --project ${PROJECT_ID} --region ${REGION} --format='value(status.traffic)'"
  if [ "${RESUME_JOBS}" = "true" ]; then
    echo "Scheduler resume requested. Verify with:"
    echo "  gcloud scheduler jobs list --project ${PROJECT_ID} --location ${JOB_LOCATION}"
  fi
else
  echo "Dry-run complete. Re-run with --apply to execute rollback."
fi
