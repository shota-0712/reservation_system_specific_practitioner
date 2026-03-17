# DB Migration Guardrails (Cloud SQL / PostgreSQL)

## Purpose
This runbook defines non-negotiable migration safety rules for production cutovers.

## 1. Metadata Requirements
- `schema_migrations` must store:
  - `filename` (PK)
  - `version` (derived from filename prefix)
  - `checksum` (SHA-256)
  - `applied_at`
- `version + checksum` must be treated as an immutable pair (no in-place rewrite).
- If an already-applied migration is found with a different checksum, deployment must fail immediately.

## 2. Timeouts
- `lock_timeout`: `5s`
- `statement_timeout`: `15min`

These defaults are the production guardrail; any deviation must be captured as an explicit waiver in the rehearsal record and approved before cutover. Migrations must set their own `SET LOCAL` values before mutating data so the guardrails always take effect regardless of the runner.

Both values are enforced during migration execution (`scripts/run_migrations_cloudbuild.sh`).
Waiver requests that change either timeout must be recorded in the rehearsal log referenced in §7, include the new timeout values, and receive explicit approval from the release lead before the cutover can proceed.

## 3. Rehearsal SLO
- Full rehearsal total duration: `<= 45 minutes`
- Single migration maximum duration: `<= 8 minutes`
- Maximum lock-wait retries per migration: `<= 3`

If any threshold is exceeded, cutover is blocked and performance tuning is required.

## 4. Cutback (Rollback) Conditions
Rollback is mandatory when any of the following is true:
- A migration step fails and cannot be retried safely within `15 minutes`.
- API error rate exceeds `2.0%` for `5 consecutive minutes` after cutover.
- P95 latency for reservation APIs degrades by `>= 50%` vs pre-cutover baseline for `10 minutes`.
- Data integrity checks fail (orphan rows, tenant-cross references, mismatch in critical counts).

Rollback consists of restoring the Cloud SQL instance via PITR/restore to the pre-cutover timestamp recorded in the rehearsal log; rolling back only the application revision does not revert the schema cleanup, so it does not meet the rollback requirement. The rehearsal record must capture the PITR timestamp and target instance so the approved rollback path is repeatable without ad-hoc guesswork.

## 5. Integrity Gates (Must Pass)
- Tenant-safe composite FK validations complete successfully.
- Reservation overlap exclusion constraint remains active.
- Reservation status transition guard remains active (`canceled/no_show` only path to slot release).
- RLS policy checks pass for app role (`app_user`) and `app_user` does not have `BYPASSRLS`.
- All repository DB access sets tenant context in transaction-local scope (`SET LOCAL app.current_tenant = ...`).
- Backfill counts match expected totals for all assignment tables.
- If migration runner cannot execute `ALTER ROLE app_user NOBYPASSRLS`, cutover is blocked until a privileged operator applies it.

## 6. Standard Execution
- Run migrations only through `scripts/run_migrations_cloudbuild.sh`.
- No ad-hoc `psql -f` direct production runs.
- Production cutover must use the same command path validated in rehearsal.

## 7. Rehearsal Record Requirements (OPS-003)
- Every rehearsal must leave evidence in `docs/runbooks/DB_V3_PHASE_B_EXECUTION_LOG.md`.
- Minimum required fields:
  - Executed date/time (JST), operator, target revisions (`reserve-api` / `reserve-admin` / `reserve-customer`)
  - Total rehearsal duration and each stage duration (preflight / smoke / rollback dry-run)
  - API request window definition (for example: last 60 minutes)
  - P95 latency and error rate values with command source
  - Rollback dry-run result (`can rollback` / `cannot rollback`) and reason
  - Final decision (`Go` / `No-Go`)

Reference command (Cloud Logging sample):

```bash
START="$(date -u -v-60M '+%Y-%m-%dT%H:%M:%SZ')"
gcloud logging read \
  "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"reserve-api\" AND logName=\"projects/${PROJECT_ID}/logs/run.googleapis.com%2Frequests\" AND timestamp>=\"${START}\" AND httpRequest.requestUrl:\"/api/v1/\"" \
  --project "${PROJECT_ID}" --limit 2000 --format=json
```

## 8. Decision Rule
- `Go`: §3 SLO と §4 rollback 条件をすべて満たす。
- `No-Go`: 1つでも超過/未充足があれば切替を停止し、修正タスクを先に完了する。
