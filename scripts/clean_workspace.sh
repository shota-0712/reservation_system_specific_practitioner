#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPLY=0
INCLUDE_TOOLS=0

usage() {
  cat <<'EOF'
Usage:
  bash scripts/clean_workspace.sh [--apply] [--include-tools]

Options:
  --apply          Actually delete files/directories (default: dry-run)
  --include-tools  Also remove local tool binaries (e.g. cloud_sql_proxy)
  -h, --help       Show this help
EOF
}

to_relative_path() {
  local abs_path="$1"
  if [[ "$abs_path" == "$ROOT_DIR/"* ]]; then
    echo "${abs_path#"$ROOT_DIR"/}"
  else
    echo "$abs_path"
  fi
}

report_item() {
  local action="$1"
  local abs_path="$2"
  local size
  size="$(du -sh "$abs_path" 2>/dev/null | awk '{print $1}')"
  if [[ -z "$size" ]]; then
    size="n/a"
  fi
  echo "[$action] $(to_relative_path "$abs_path") (${size})"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      APPLY=1
      ;;
    --include-tools)
      INCLUDE_TOOLS=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

declare -a TARGETS=(
  "${ROOT_DIR}/node_modules"
  "${ROOT_DIR}/admin-dashboard/node_modules"
  "${ROOT_DIR}/admin-dashboard/.next"
  "${ROOT_DIR}/backend-v2/node_modules"
  "${ROOT_DIR}/backend-v2/dist"
  "${ROOT_DIR}/landing-page/node_modules"
  "${ROOT_DIR}/landing-page/.next"
  "${ROOT_DIR}/backend-v2/coverage"
  "${ROOT_DIR}/admin-dashboard/coverage"
  "${ROOT_DIR}/landing-page/coverage"
  "${ROOT_DIR}/curl"
  "${ROOT_DIR}/echo"
  "${ROOT_DIR}/-sS"
  "${ROOT_DIR}/EXIT: "
)

if [[ "$INCLUDE_TOOLS" -eq 1 ]]; then
  TARGETS+=("${ROOT_DIR}/cloud_sql_proxy")
fi

echo "Workspace root: $ROOT_DIR"
if [[ "$APPLY" -eq 1 ]]; then
  echo "Mode: APPLY (files/directories will be removed)"
else
  echo "Mode: DRY-RUN (no files/directories will be removed)"
fi
echo

removed_count=0
candidate_count=0

for target in "${TARGETS[@]}"; do
  if [[ -e "$target" ]]; then
    candidate_count=$((candidate_count + 1))
    if [[ "$APPLY" -eq 1 ]]; then
      report_item "REMOVE" "$target"
      rm -rf "$target"
      removed_count=$((removed_count + 1))
    else
      report_item "CANDIDATE" "$target"
    fi
  fi
done

while IFS= read -r ds_store; do
  [[ -z "$ds_store" ]] && continue
  candidate_count=$((candidate_count + 1))
  if [[ "$APPLY" -eq 1 ]]; then
    report_item "REMOVE" "$ds_store"
    rm -f "$ds_store"
    removed_count=$((removed_count + 1))
  else
    report_item "CANDIDATE" "$ds_store"
  fi
done < <(find "$ROOT_DIR" -name '.DS_Store' -type f 2>/dev/null)

echo
if [[ "$APPLY" -eq 1 ]]; then
  echo "Removed: $removed_count item(s)"
else
  echo "Found: $candidate_count cleanup candidate(s)"
  echo "Run with --apply to remove them."
fi
