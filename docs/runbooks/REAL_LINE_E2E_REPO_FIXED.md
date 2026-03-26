# Real LINE E2E Repo Fix

This runbook fixes the last manual piece of the dev-v3 real LINE smoke flow: the findings sheet now lives in the repo as a template, and the helper script expands it to `/tmp/reserve-v3-findings.<env>.md` before the run.

Current canonical evidence log is [`docs/runbooks/DB_V3_FEATURE_VERIFICATION.md`](./DB_V3_FEATURE_VERIFICATION.md). This file remains the operator-focused helper note for preparing the workbook and preflight commands.

## What Changed

- The findings sheet is tracked at `docs/runbooks/reserve-v3-findings.template.md`.
- The helper script writes `/tmp/reserve-v3-findings.dev-v3.md` or `/tmp/reserve-v3-findings.live.md` from that template, unless `OUTPUT_PATH` is overridden.
- `dev-v3` no longer trusts baked-in tenant/token defaults. It now resolves manual input from explicit env vars first, then `INPUT_JSON`, then the latest local `scripts/out/feature_verification/dev-v3/*/public_onboarding.json`.
- Booking-link bootstrap on the customer app now uses only an explicit URL tenant hint, so the token-only URL can initialize without relying on stale localStorage.
- The helper script runs a real preflight before printing a green manual handoff. It now fails fast when `auth/config` is not runnable, when either booking-link resolve path fails, or when `liffId` is empty.
- An empty `liffId` is treated as an ops/config blocker, not as a repo-status pass.

## Usage

Run the helper once before opening the app:

```bash
./scripts/prepare_real_line_e2e.sh dev-v3
./scripts/prepare_real_line_e2e.sh live
```

The script prints:

- Root URL
- Booking token URL
- Preflight curl commands
- Log watch command
- `auth/session 401` x2 recovery command
- Findings workbook path (`/tmp/reserve-v3-findings.<env>.md` by default, or `OUTPUT_PATH` when overridden)

If preflight fails, the script exits non-zero and does not present the manual run as ready.

## Acceptance

- The root URL opens and reaches the LIFF flow.
- The booking token URL opens and also reaches the LIFF flow without query tenant or localStorage tenant state.
- `/tmp/reserve-v3-findings.<env>.md` exists and is ready for manual notes.
- Preflight and log watch commands are available from one invocation of the helper script.
- `auth/config` returns a non-empty `liffId`; otherwise the run stops for tenant LINE config remediation.

## Recovery

If `auth/session 401` happens twice in a row, use the helper script output to re-check the LINE credentials and reapply the tenant LINE config before retrying the app flow.
