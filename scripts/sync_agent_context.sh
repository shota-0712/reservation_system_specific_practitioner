#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_FILE="${ROOT_DIR}/docs/PROJECT_MEMORY.md"

if [[ ! -f "${SOURCE_FILE}" ]]; then
  echo "source file not found: ${SOURCE_FILE}" >&2
  exit 1
fi

for target in "${ROOT_DIR}/CLAUDE.md" "${ROOT_DIR}/CODEX.md"; do
  {
    echo "<!-- AUTO-GENERATED: edit docs/PROJECT_MEMORY.md and run npm run sync:agent-context -->"
    echo
    cat "${SOURCE_FILE}"
    echo
  } > "${target}"
done

echo "Synced:"
echo "  - CLAUDE.md"
echo "  - CODEX.md"
