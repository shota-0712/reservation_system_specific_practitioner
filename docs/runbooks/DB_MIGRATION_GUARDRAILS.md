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

Both values are enforced during migration execution (`scripts/run_migrations_cloudbuild.sh`).

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
