# DB V3 Completeness Audit

更新日時: 2026-03-22 JST

## 1. Purpose

This runbook is the canonical evidence record for DB V3 completeness.
It separates proof for a disposable fresh bootstrap from proof for a live or upgraded DB.

## 2. Audit Modes

### 2.1 Fresh

Use fresh mode after bootstrapping a disposable local PostgreSQL cluster from `database/schema/001_initial_schema.sql`.

```bash
bash scripts/db_v3.sh bootstrap-fresh
bash scripts/db_v3.sh status-fresh
```

Or run the wrapper:

```bash
bash scripts/run_db_completeness_audit.sh fresh
```

Fresh mode proves:

- expected public schema shape
- no legacy columns
- helper functions present with `SECURITY DEFINER` and `EXECUTE` for `app_user`
- FORCE RLS on the expected tenant-scoped tables
- `app_user.rolbypassrls=false`

Fresh mode does not require repo migration checksum equality semantics.
It may also run `/health`, `/ready`, and smoke when `API_URL` and `FIREBASE_API_KEY` are supplied. Request-log checks in fresh mode are optional and require `RUN_REQUEST_LOG_CHECK=true` plus `PROJECT_ID`.

### 2.2 Live

Use live mode against `reservation-system-db` and treat the DB as read-only for audit purposes.

```bash
PROJECT_ID=keyexpress-reserve \
CLOUDSQL_INSTANCE=reservation-system-db \
CLOUDSQL_PROXY_USE_GCLOUD_AUTH=true \
DB_USER=migration_user \
DB_PASSWORD_SECRET=db-password-migration \
bash scripts/db_v3.sh status
```

Or run the wrapper:

```bash
PROJECT_ID=keyexpress-reserve \
CLOUDSQL_INSTANCE=reservation-system-db \
CLOUDSQL_PROXY_USE_GCLOUD_AUTH=true \
DB_USER=migration_user \
DB_PASSWORD_SECRET=db-password-migration \
FIREBASE_API_KEY="$(firebase apps:sdkconfig web 1:486894262412:web:8b10231452c569388583a9 --project keyexpress-reserve | jq -r .apiKey)" \
bash scripts/run_db_completeness_audit.sh live
```

Live mode proves everything in fresh mode plus:

- repo migration checksum equality against `database/migrations/*.sql`
- no missing repo migrations
- no unexpected DB-only migration rows
- `/health` and `/ready`
- `scripts/smoke_public_onboarding.sh`
- Cloud Logging request-log checks over the freshness window, with non-zero `reserve-api` traffic required and `reserve-admin` / `reserve-customer` zero-traffic treated as informational only
- `id_mappings` is allowed as an upgrade-only retained table in live/upgraded DBs and is not treated as drift

## 3. Artifact Location

The wrapper writes logs under:

```text
scripts/out/db_completeness_audit/<mode>/<timestamp>/
```

Each run records at minimum:

- `audit.log`
- `db_v3.status.log` or `db_v3.status-fresh.log`
- `health.json`
- `ready.json`
- `smoke_public_onboarding.log`
- `request-log-summary.txt`

## 4. Failure Criteria

The audit fails if any of the following is observed:

- legacy columns remain
- helper functions are missing or lose `SECURITY DEFINER`
- `app_user` has `rolbypassrls=true`
- any expected tenant-scoped table loses `FORCE ROW LEVEL SECURITY`
- repo migration checksum mismatch
- missing repo migration rows in live mode
- unexpected DB-only migration rows in live mode
- unexpected DB-only tables other than the allowed upgrade-only `id_mappings`
- `reserve-api` has no request traffic in the freshness window
- request-log 5xx rate exceeds `2.0%`
- UUID regression appears in Cloud Logging

## 5. Reporting Rule

Record the final decision in this runbook first.
Reference this runbook from `DB_MIGRATION_GUARDRAILS.md`, `DB_V3_SCHEMA_DEFINITION.md`, and any release readiness note that needs the current evidence pointer.

## 6. Latest Evidence

### 6.1 Fresh Bootstrap Audit

- Executed: 2026-03-22 JST
- Disposable cluster: `/tmp/reserve-db-audit-pg-codex`
- DB: `reservation_system_audit`
- Artifact: `scripts/out/db_completeness_audit/fresh/20260322T081637Z`
- Result: `PASS`

Observed pass conditions:

- `status-fresh`: `expected_tables=28 actual_tables=28`
- `schema_migrations`: `latest_filename=(empty) applied_count=0`
- `legacy_columns`: `(none)`
- helper functions: both present with `SECURITY DEFINER` + `EXECUTE app_user`
- FORCE RLS: all 26 expected tenant-scoped tables returned `t|t`
- `app_user_role`: `rolbypassrls=f`

Supporting code verification executed in the same slice:

- `RUN_INTEGRATION=true npx vitest run tests/unit/export-job.service.test.ts tests/unit/google-calendar.service.test.ts tests/unit/google-calendar-sync.service.test.ts tests/unit/google-calendar-sync-queue.service.test.ts tests/unit/karte.repository.test.ts tests/unit/salonboard.repository.test.ts tests/unit/salonboard.service.test.ts tests/integration/export.routes.test.ts tests/integration/google-calendar.routes.test.ts tests/integration/karte.routes.test.ts tests/integration/salonboard.routes.test.ts`
- Result: `11 files passed / 44 tests passed`

### 6.2 Live Audit (Pre-remediation)

- Executed: 2026-03-22 JST
- Target DB: `reservation-system-db`
- DB result: `NO-GO`
- Runtime result: `/health` PASS, `/ready` PASS, `scripts/smoke_public_onboarding.sh` PASS

Observed DB drift at the time:

- `schema_shape`: the old status logic surfaced `id_mappings`; this is now reclassified as an allowed upgrade-only retained table and is not a blocker
- `missing_repo_migrations`:
  - `20260313_salonboard_hardening.sql`
  - `20260322_tenant_google_calendar_oauth_rls.sql`
- `checksum_mismatches`:
  - `20260312_v3_hard_cleanup.sql`
- `legacy_columns`: `(none)`
- helper functions: both present with `SECURITY DEFINER` + `EXECUTE app_user`
- FORCE RLS gaps:
  - `audit_logs`: `rls_enabled=t`, `force_rls=f`
  - `tenant_google_calendar_oauth`: `rls_enabled=f`, `force_rls=f`
  - `tenant_salonboard_config`: `rls_enabled=f`, `force_rls=f`
- `app_user_role`: `rolbypassrls=f`

Observed runtime checks:

- `/health`: `{"status":"healthy"}`
- `/ready`: `database=true`, `firebase=true`, `googleOauthConfigured=true`
- Public onboarding smoke completed successfully
  - `tenantSlug=smoke-salon-1774165504`
  - `tenantId=2c3b539f-0482-44ce-8cde-ddeace777711`
  - `reservationId=c45a5744-420e-4de3-b71f-39d0676e3923`

Observed request-log window (last 60 minutes):

- `reserve-api total=15 five_xx=0 error_rate=0.00% uuid_hits=0`
- `reserve-admin total=0 five_xx=0 error_rate=0.00% uuid_hits=0`
- `reserve-customer total=0 five_xx=0 error_rate=0.00% uuid_hits=0`

Decision:

- Runtime service health is acceptable.
- DB completeness is not acceptable until the missing migrations are applied through Cloud Build and the live checksum / FORCE RLS drift is cleared.

### 6.3 Live Remediation Closure

- Cloud Build attempt 1: `08291474-b22c-4f75-90e8-96ac541c860c` on 2026-03-22 17:25:07 JST
  - Result: `FAILURE` at post-migration verification only
  - Observed effect: `20260313_salonboard_hardening.sql`, `20260322_tenant_google_calendar_oauth_rls.sql`, and `20260323_audit_logs_force_rls.sql` were applied through `scripts/run_migrations_cloudbuild.sh`
  - Blocker: repo `20260312_v3_hard_cleanup.sql` checksum assumption was wrong for the already-applied live row
- Historical applied checksum source:
  - Successful Build B archive: `4c1600d4-ceab-456a-a796-cef694c67434`
  - Source object: `gs://keyexpress-reserve_cloudbuild/source/1773932233.409144-f81674d6e03845f89478c749c4a285bb.tgz`
  - `database/migrations/20260312_v3_hard_cleanup.sql` checksum in that archive: `aec27f0be1fa2eabe97eaca4d85bb67592b47defffe03dbfcb0b7fb4ff4663c7`
  - Remediation action: repo file restored to the exact historical Build B source so the immutable applied checksum and repo file match again
- Cloud Build retry: `d28e0ba4-efe3-4df4-abeb-0cc36f6f6dbb`
  - Result: `SUCCESS`
  - Finish time: 2026-03-22 17:33:45 JST
  - Deployed revision: `reserve-api-00048-kw4`
- Final live audit:
  - Executed: 2026-03-22 17:34 JST
  - Artifact: `scripts/out/db_completeness_audit/live/20260322T083420Z`
  - Result: `PASS`

Observed pass conditions:

- `status`: `expected_tables=28 actual_tables=29`
- `allowed_upgrade_only_tables`: `id_mappings`
- `missing_repo_migrations`: `(none)`
- `checksum_mismatches`: `(none)`
- `unexpected_db_migrations`: `(none)`
- `legacy_columns`: `(none)`
- helper functions: both present with `SECURITY DEFINER` + `EXECUTE app_user`
- FORCE RLS: all 26 expected tenant-scoped tables returned `t|t`, including `audit_logs`, `tenant_google_calendar_oauth`, and `tenant_salonboard_config`
- `app_user_role`: `rolbypassrls=f`

Observed runtime checks:

- `/health`: `{"success":true,"data":{"status":"healthy",...}}`
- `/ready`: `ready=true`, `database=true`, `firebase=true`, `googleOauthConfigured=true`
- Public onboarding smoke completed successfully
  - `tenantSlug=smoke-salon-1774168464`
  - `tenantId=22fa1931-8b5b-43af-bb3c-3367636e2d9a`
  - `reservationId=9ed72be1-6dd4-49e9-acf2-ec840cfae508`
  - `bookingLinkToken=iqf2hD6sI96eqNe2BndIe-9MaahuVEGU`
- Request-log window (last 60 minutes):
  - `reserve-api total=300 five_xx=0 error_rate=0.00% uuid_hits=0`
  - `reserve-admin total=88 five_xx=0 error_rate=0.00% uuid_hits=0`
  - `reserve-customer total=10 five_xx=0 error_rate=0.00% uuid_hits=0`

Decision:

- DB completeness is now acceptable on the live DB.
- Release evidence for DB V3 remediation is complete as of 2026-03-22 17:34 JST.
