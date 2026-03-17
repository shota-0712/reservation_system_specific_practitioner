#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Inspect and operate Cloud SQL instances.

Default mode is dry-run. Use --apply to execute changes.

Required env vars:
  PROJECT_ID

Optional env vars:
  REGION
    Cloud Run region used when listing attached services. Default: asia-northeast1
  WAIT_TIMEOUT_SECONDS
    Max seconds to wait for MAINTENANCE / running operations to clear. Default: 1800
  WAIT_INTERVAL_SECONDS
    Poll interval while waiting. Default: 30
  PRIMARY_INSTANCE
    Cloud SQL instance to stop/start. Default: reservation-system-db
  DEV_INSTANCE
    Extra dev instance to inspect or delete. Default: reservation-system-db-dev-v3

Usage:
  PROJECT_ID=keyexpress-reserve ./scripts/rightsize_cloud_sql.sh

  PROJECT_ID=keyexpress-reserve ./scripts/rightsize_cloud_sql.sh --stop

  PROJECT_ID=keyexpress-reserve ./scripts/rightsize_cloud_sql.sh --stop --apply

  PROJECT_ID=keyexpress-reserve ./scripts/rightsize_cloud_sql.sh --start --apply

  PROJECT_ID=keyexpress-reserve DEV_INSTANCE=reservation-system-db-dev-v3 \
    ./scripts/rightsize_cloud_sql.sh --delete-dev --apply
USAGE
}

APPLY=false
START_PRIMARY=false
STOP_PRIMARY=false
DELETE_DEV=false

while [ $# -gt 0 ]; do
  case "$1" in
    --apply)
      APPLY=true
      ;;
    --start)
      START_PRIMARY=true
      ;;
    --stop)
      STOP_PRIMARY=true
      ;;
    --delete-dev)
      DELETE_DEV=true
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
  shift
done

: "${PROJECT_ID:?PROJECT_ID is required}"

REGION="${REGION:-asia-northeast1}"
WAIT_TIMEOUT_SECONDS="${WAIT_TIMEOUT_SECONDS:-1800}"
WAIT_INTERVAL_SECONDS="${WAIT_INTERVAL_SECONDS:-30}"
PRIMARY_INSTANCE="${PRIMARY_INSTANCE:-reservation-system-db}"
DEV_INSTANCE="${DEV_INSTANCE:-reservation-system-db-dev-v3}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud command not found"
  exit 1
fi

require_positive_integer() {
  local name="$1"
  local value="$2"

  if ! [[ "${value}" =~ ^[0-9]+$ ]] || [ "${value}" -le 0 ]; then
    echo "ERROR: ${name} must be a positive integer (got '${value}')"
    exit 1
  fi
}

require_positive_integer "WAIT_TIMEOUT_SECONDS" "${WAIT_TIMEOUT_SECONDS}"
require_positive_integer "WAIT_INTERVAL_SECONDS" "${WAIT_INTERVAL_SECONDS}"

action_count=0
if [ "${START_PRIMARY}" = "true" ]; then
  action_count=$((action_count + 1))
fi
if [ "${STOP_PRIMARY}" = "true" ]; then
  action_count=$((action_count + 1))
fi
if [ "${DELETE_DEV}" = "true" ]; then
  action_count=$((action_count + 1))
fi

if [ "${action_count}" -gt 1 ]; then
  echo "ERROR: choose only one action: --start, --stop, or --delete-dev"
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

instance_exists() {
  local instance="$1"
  gcloud sql instances describe "${instance}" \
    --project "${PROJECT_ID}" \
    --format="value(name)" >/dev/null 2>&1
}

instance_value() {
  local instance="$1"
  local path="$2"
  gcloud sql instances describe "${instance}" \
    --project "${PROJECT_ID}" \
    --format="value(${path})" 2>/dev/null | tr -d '\r'
}

instance_state() {
  local instance="$1"
  instance_value "${instance}" "state"
}

instance_suspension_reasons() {
  local instance="$1"
  instance_value "${instance}" "suspensionReason.list()"
}

blocking_operations() {
  local instance="$1"
  gcloud sql operations list \
    --project "${PROJECT_ID}" \
    --instance "${instance}" \
    --limit=100 \
    --filter='status=RUNNING' \
    --format='csv[no-heading](name,operationType,status,startTime)' 2>/dev/null \
    | awk -F',' '$2 == "UPDATE" || $2 == "CREATE" || $2 == "DELETE" { print $1 "|" $2 "|" $3 "|" $4 }'
}

print_blocking_operations() {
  local operations="$1"
  local operation_id operation_type operation_status start_time

  if [ -z "${operations}" ]; then
    echo "INFO: blocking operations: none"
    return
  fi

  while IFS='|' read -r operation_id operation_type operation_status start_time; do
    [ -n "${operation_id}" ] || continue
    echo "INFO: blocking operation id=${operation_id} type=${operation_type} start=${start_time} status=${operation_status}"
  done <<< "${operations}"
}

print_instance_summary() {
  local instance="$1"

  if ! instance_exists "${instance}"; then
    echo "INFO: Cloud SQL instance not found (${instance})"
    return
  fi

  echo "Cloud SQL summary: ${instance}"
  gcloud sql instances describe "${instance}" \
    --project "${PROJECT_ID}" \
    --format='yaml(name,state,suspensionReason,connectionName,settings.edition,settings.tier,settings.dataCacheConfig.dataCacheEnabled,settings.activationPolicy,settings.availabilityType,settings.dataDiskSizeGb,settings.dataDiskType,createTime)'
}

print_attached_services() {
  local instance="$1"
  local connection_name

  if ! instance_exists "${instance}"; then
    echo "INFO: Cloud SQL instance not found (${instance})"
    return
  fi

  connection_name="$(instance_value "${instance}" "connectionName")"
  if [ -z "${connection_name}" ]; then
    echo "INFO: no connection name found for ${instance}"
    return
  fi

  echo "Cloud Run services using ${instance}:"
  gcloud run services list \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --format='csv[no-heading](metadata.name,spec.template.metadata.annotations.[run.googleapis.com/cloudsql-instances])' \
    | awk -F',' -v target="${connection_name}" '$2 == target { print $1 " " $2; found=1 } END { if (!found) exit 1 }' \
    || echo "INFO: no Cloud Run service attachment found for ${instance}"
}

ensure_instance_is_actionable() {
  local instance="$1"
  local action_label="$2"
  local state reasons
  state="$(instance_state "${instance}")"
  reasons="$(instance_suspension_reasons "${instance}")"

  if [ "${state}" = "SUSPENDED" ]; then
    echo "ERROR: ${instance} is SUSPENDED (${reasons:-unknown reason})."
    echo "ERROR: Cloud SQL ${action_label} requests fail while the instance is suspended."
    echo "NEXT: restore project billing first, then rerun this script with --apply."
    exit 1
  fi
}

wait_until_instance_ready() {
  local instance="$1"
  local action_label="$2"
  local deadline=$((SECONDS + WAIT_TIMEOUT_SECONDS))
  local state operations recheck_state recheck_operations

  while true; do
    ensure_instance_is_actionable "${instance}" "${action_label}"
    state="$(instance_state "${instance}")"
    operations="$(blocking_operations "${instance}")"

    if [ "${state}" != "MAINTENANCE" ] && [ -z "${operations}" ]; then
      ensure_instance_is_actionable "${instance}" "${action_label}"
      recheck_state="$(instance_state "${instance}")"
      recheck_operations="$(blocking_operations "${instance}")"

      if [ "${recheck_state}" != "MAINTENANCE" ] && [ -z "${recheck_operations}" ]; then
        echo "INFO: wait complete for ${instance}: state=${recheck_state}"
        return 0
      fi

      state="${recheck_state}"
      operations="${recheck_operations}"
    fi

    if [ "${SECONDS}" -ge "${deadline}" ]; then
      echo "ERROR: timed out waiting to ${action_label} ${instance} after ${WAIT_TIMEOUT_SECONDS}s."
      echo "ERROR: last seen state=${state}"
      print_blocking_operations "${operations}"
      return 1
    fi

    echo "INFO: waiting to ${action_label} ${instance}: state=${state}"
    if [ -n "${operations}" ]; then
      print_blocking_operations "${operations}"
    else
      echo "INFO: no blocking operations; waiting for state to leave MAINTENANCE."
    fi

    sleep "${WAIT_INTERVAL_SECONDS}"
  done
}

patch_activation_policy() {
  local instance="$1"
  local action_label="$2"
  local activation_policy="$3"
  local message="$4"

  if [ "${APPLY}" = "true" ]; then
    wait_until_instance_ready "${instance}" "${action_label}"
  fi

  echo "Patch activation policy (${action_label}):"
  run_cmd gcloud sql instances patch "${instance}" \
    --project "${PROJECT_ID}" \
    --activation-policy="${activation_policy}" \
    --quiet
  if [ "${APPLY}" = "true" ]; then
    echo "INFO: ${message}"
  fi
}

delete_dev_instance() {
  if ! instance_exists "${DEV_INSTANCE}"; then
    echo "INFO: dev instance not found (${DEV_INSTANCE})"
    return
  fi

  if [ "${APPLY}" = "true" ]; then
    wait_until_instance_ready "${DEV_INSTANCE}" "delete"
  fi

  echo "Delete dev instance:"
  run_cmd gcloud sql instances delete "${DEV_INSTANCE}" \
    --project "${PROJECT_ID}" \
    --quiet
  if [ "${APPLY}" = "true" ]; then
    echo "INFO: wait complete -> delete issued for ${DEV_INSTANCE}"
  fi
}

print_examples() {
  echo "INFO: no action selected; status only."
  echo "INFO: next commands:"
  echo "  PROJECT_ID=${PROJECT_ID} ./scripts/rightsize_cloud_sql.sh --stop --apply"
  echo "  PROJECT_ID=${PROJECT_ID} ./scripts/rightsize_cloud_sql.sh --start --apply"
}

echo "INFO: project=${PROJECT_ID} region=${REGION}"
echo "INFO: wait settings => timeout=${WAIT_TIMEOUT_SECONDS}s interval=${WAIT_INTERVAL_SECONDS}s"

print_instance_summary "${PRIMARY_INSTANCE}"
if instance_exists "${PRIMARY_INSTANCE}"; then
  print_attached_services "${PRIMARY_INSTANCE}"
fi
echo
print_instance_summary "${DEV_INSTANCE}"
if instance_exists "${DEV_INSTANCE}"; then
  print_attached_services "${DEV_INSTANCE}"
fi
echo

if [ "${STOP_PRIMARY}" = "true" ]; then
  patch_activation_policy "${PRIMARY_INSTANCE}" "stop" "NEVER" "instance stop requested for ${PRIMARY_INSTANCE}"
elif [ "${START_PRIMARY}" = "true" ]; then
  patch_activation_policy "${PRIMARY_INSTANCE}" "start" "ALWAYS" "instance start requested for ${PRIMARY_INSTANCE}"
elif [ "${DELETE_DEV}" = "true" ]; then
  delete_dev_instance
else
  print_examples
fi

if [ "${APPLY}" = "true" ] && [ "${STOP_PRIMARY}" = "true" ]; then
  echo "Stop applied."
elif [ "${APPLY}" = "true" ] && [ "${START_PRIMARY}" = "true" ]; then
  echo "Start applied."
elif [ "${APPLY}" = "true" ] && [ "${DELETE_DEV}" = "true" ]; then
  echo "Delete applied."
elif [ "${action_count}" -gt 0 ]; then
  echo "Dry-run complete. Re-run with --apply to execute."
fi
