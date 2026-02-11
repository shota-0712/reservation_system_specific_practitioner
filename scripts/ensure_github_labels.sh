#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI is required."
  exit 1
fi

REPO="${GITHUB_REPO:-}"
if [ -z "${REPO}" ]; then
  remote_url="$(git remote get-url origin 2>/dev/null || true)"
  if [[ "${remote_url}" =~ github.com[:/]([^/]+/[^/.]+) ]]; then
    REPO="${BASH_REMATCH[1]}"
  fi
fi

if [ -z "${REPO}" ]; then
  echo "ERROR: GITHUB_REPO is required (owner/repo)."
  exit 1
fi

gh label create backend --repo "${REPO}" --color "1D76DB" --description "Backend/API changes" --force
gh label create admin --repo "${REPO}" --color "5319E7" --description "Admin dashboard changes" --force
gh label create customer --repo "${REPO}" --color "0E8A16" --description "Customer app changes" --force
gh label create infra --repo "${REPO}" --color "FBCA04" --description "Cloud/CI/CD/infra changes" --force
gh label create docs --repo "${REPO}" --color "C2E0C6" --description "Documentation changes" --force

echo "GitHub labels are configured for ${REPO}."
