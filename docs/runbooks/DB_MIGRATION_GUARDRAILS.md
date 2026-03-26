# DB Migration Guardrails (Cloud SQL / PostgreSQL)

## Purpose
This runbook defines non-negotiable migration safety rules and the canonical live-DB verification checklist for production cutovers.

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
Waiver requests that change either timeout must be recorded in the rehearsal log referenced in §8, include the new timeout values, and receive explicit approval from the release lead before the cutover can proceed.

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

## 6. Completeness Audit

Current canonical audit entrypoint:

```bash
bash scripts/run_db_completeness_audit.sh fresh
bash scripts/run_db_completeness_audit.sh live
```

Direct DB entrypoints:

```bash
bash scripts/db_v3.sh status-fresh
bash scripts/db_v3.sh status
```

Interpretation:

- `status-fresh` is for a disposable bootstrap and does not require repo migration checksum equality.
- `status` is for live or upgraded DBs and must fail on checksum mismatch, missing repo migrations, or unexpected DB-only migration rows.
- Both modes must fail on legacy columns, helper-function drift, missing FORCE RLS, and `app_user.rolbypassrls=true`.

Live audit output is centralized in `docs/runbooks/DB_V3_COMPLETENESS_AUDIT.md`. This runbook remains the source for migration guardrails and low-level SQL fallback queries.

When the output is not clean:

- Do not describe the DB as merely "unsupported" or "not ready".
- If migrations are missing, record the exact unapplied filenames.
- If helper functions, RLS flags, or role attributes differ, record the exact object name and observed value.

Fallback commands when only `psql` is available:

```bash
# Missing repo migrations (run from repo root)
comm -23 \
  <(find database/migrations -maxdepth 1 -type f -name '*.sql' -exec basename {} \; | sort) \
  <(psql -h 127.0.0.1 -U migration_user -d reservation_system -Atc \
      "SELECT filename FROM schema_migrations ORDER BY filename")

# Legacy columns
psql -h 127.0.0.1 -U migration_user -d reservation_system -c "
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema='public'
    AND (
      (table_name='reservations' AND column_name IN ('period','date','start_time','end_time'))
      OR (table_name='practitioners' AND column_name='store_ids')
      OR (table_name='menus' AND column_name='practitioner_ids')
      OR (table_name='menu_options' AND column_name='applicable_menu_ids')
      OR (table_name='admins' AND column_name='store_ids')
    )
  ORDER BY table_name, column_name;"

# Helper functions
psql -h 127.0.0.1 -U migration_user -d reservation_system -c "
  WITH expected(routine_name) AS (
    VALUES ('resolve_active_store_context'),
           ('resolve_booking_link_token')
  )
  SELECT
      e.routine_name,
      EXISTS (
          SELECT 1
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname = e.routine_name
      ) AS present,
      COALESCE((
          SELECT p.prosecdef
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname = e.routine_name
          LIMIT 1
      ), false) AS security_definer,
      EXISTS (
          SELECT 1
          FROM information_schema.role_routine_grants g
          WHERE g.routine_schema = 'public'
            AND g.routine_name = e.routine_name
            AND g.grantee = 'app_user'
            AND g.privilege_type = 'EXECUTE'
      ) AS app_user_execute
  FROM expected e
  ORDER BY e.routine_name;"

# FORCE RLS
psql -h 127.0.0.1 -U migration_user -d reservation_system -c "
  WITH expected(table_name) AS (
    VALUES
      ('stores'),
      ('practitioners'),
      ('menus'),
      ('menu_options'),
      ('customers'),
      ('reservations'),
      ('reservation_menus'),
      ('reservation_options'),
      ('kartes'),
      ('karte_templates'),
      ('admins'),
      ('daily_analytics'),
      ('settings'),
      ('audit_logs'),
      ('service_message_logs'),
      ('tenant_google_calendar_oauth'),
      ('tenant_salonboard_config'),
      ('google_calendar_sync_tasks'),
      ('booking_link_tokens'),
      ('practitioner_store_assignments'),
      ('menu_practitioner_assignments'),
      ('option_menu_assignments'),
      ('admin_store_assignments'),
      ('export_jobs'),
      ('tenant_rfm_settings'),
      ('tenant_notification_settings')
  )
  SELECT
      e.table_name,
      COALESCE(c.relrowsecurity, false) AS rls_enabled,
      COALESCE(c.relforcerowsecurity, false) AS force_rls
  FROM expected e
  LEFT JOIN pg_class c
    ON c.relname = e.table_name
   AND c.relkind = 'r'
  LEFT JOIN pg_namespace n
    ON n.oid = c.relnamespace
   AND n.nspname = 'public'
  ORDER BY e.table_name;"

# app_user role attribute
psql -h 127.0.0.1 -U migration_user -d reservation_system -c "
  SELECT rolname, rolbypassrls
  FROM pg_roles
  WHERE rolname = 'app_user';"
```

## 7. Standard Execution
- Run migrations only through `scripts/run_migrations_cloudbuild.sh`.
- Run post-migration proof through `scripts/run_db_completeness_audit.sh live` or `bash scripts/db_v3.sh status` after Cloud Build.
- No ad-hoc `psql -f` direct production runs.
- Production cutover must use the same command path validated in rehearsal.

## 8. Rehearsal Record Requirements (OPS-003)
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

## 9. Decision Rule
- `Go`: §3 SLO と §4 rollback 条件をすべて満たす。
- `No-Go`: 1つでも超過/未充足があれば切替を停止し、修正タスクを先に完了する。
