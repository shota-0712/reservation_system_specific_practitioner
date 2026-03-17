# Release Readiness Report

更新日時: 2026-03-18 JST

## Purpose
- This is the canonical Go/No-Go runbook for the same-window release. Architecture docs under `docs/architecture` remain the authoritative design reference; this file captures the live production state, release history, and hardening timeline that operators must follow during cutover.
- The runbook’s target scope is limited to backend fixes, repository/DB hardening, migration guardrails, and supporting release instructions; Firestore migration helpers are being investigated separately and are excluded from this production release validation.

## 1. Same-Window Phase
- **判定: Go.** Phase 0 hardening complete. All four checklist items confirmed ✅. Quality gates pass (lint / typecheck / 110 tests / build). Release may proceed to Phase 1.
- **Phase 0 hardening guardrails (all confirmed ✅ 2026-03-18):**
  1. ✅ Assignment tables become the only supported relationships for menus/options/practitioners, and repository code propagates `42P01` instead of falling back to legacy array columns. (`fail-fast` tests: 7 cases in `repository.assignment-schema.test.ts`)
  2. ✅ `20260312_v3_hard_cleanup.sql` enforces four legacy prechecks (menus.practitioner_ids vs assignments, menu_options.applicable_menu_ids vs assignments, practitioner_store_assignments, and the existing admin store check) plus guardrail `SET LOCAL lock_timeout = '5s'` and `statement_timeout = '15min'`.
  3. ✅ `database/seeds/001_dev_seed.sql` targets the v3 schema (assignment tables, `starts_at`/`ends_at`, timezone-aware reservations) and `docs/runbooks/DB_MIGRATION_GUARDRAILS.md` documents the timeout waiver approval process and PITR-only rollback requirement.
  4. ✅ This runbook and any related release notes clearly state that the Firestore migration helper is not part of the current production cutover; its investigation output feeds the next release slice.
- Same-window proceeds only after Phase 0 edits merge, backend quality gates pass in a clean worktree, and this document is marked Go with the date/time updated here.

## 2. Live-State Facts (2026-03-17)

### 2.1 Cloud SQL & readiness
- `PROJECT_ID=keyexpress-reserve ./scripts/rightsize_cloud_sql.sh --start --apply`.
- Cloud SQL `reservation-system-db`: `RUNNABLE`.
- `reserve-api /ready`: `ready=true`.
- `rightsize_cloud_sql.sh` exited non-zero after timing out waiting for the operation, but `gcloud sql instances describe` shows `RUNNABLE`.

### 2.2 Database inspection
- Connected as `migration_user` via Cloud SQL Proxy.
- Latest `schema_migrations`: `20260311_mt_wave1_rls_hardening.sql`; `20260312_v3_hard_cleanup.sql` still pending.
- Legacy columns observed: `admins.store_ids`, `menu_options.applicable_menu_ids`, `menus.practitioner_ids`, `practitioners.store_ids`, `reservations.date`, `reservations.end_time`, `reservations.period`, `reservations.start_time`.
- Functions: `resolve_active_store_context`, `resolve_booking_link_token`.
- RLS: `booking_link_tokens`, `export_jobs`, `tenant_notification_settings`, `tenant_rfm_settings` are FORCE ROW LEVEL SECURITY.
- `app_user`: `rolbypassrls = false`.

### 2.3 Smoke evidence
- `API_URL=https://reserve-api-czjwiprc2q-an.a.run.app FIREBASE_API_KEY=<configured> RUN_RESERVATION_TEST=true ./scripts/smoke_public_onboarding.sh`.
- Observed: `registration-config` pass, Firebase signup pass, `onboarding/register` pass, `GET /api/v1/smoke-salon-1773680978/auth/config` returned `500`.

### 2.4 Cloud Run logs
- Service `reserve-api`, revision `reserve-api-00044-2bp`, path `/api/v1/smoke-salon-1773680978/auth/config` logged `invalid input syntax for type uuid: ""` inside tenant middleware store-code lookup.
- **2026-03-18 Fix confirmed:** `tenant.ts` already contains `isUuidLike` / `isStoreCodeLike` guards that prevent UUID cast for hyphenated slug keys. `tenant.middleware.test.ts` covers the `22P02` recoverable error path and `42883` fail-fast propagation. Test suite: 110 tests pass.

## 3. Same-Window Execution Plan

### Phase 1 – Build the clean release slice
- `git fetch origin`.
- `git worktree add /tmp/release-clean origin/main` (or equivalent) to start from `origin/main`. The clean tree must contain only the Phase 0 hardening diffs (backend fix, repository kinetics, migration/seed/runbook updates, and targeted tests); do not carry unrelated files or additional experimentation.
- Export the whitelist patch from the dirty tree, then replay just those diffs into the clean tree so the release slice is isolated. Keep every stage of the release anchored to this clean worktree and delete it once the release is complete.
- Inside the clean tree run `npm --prefix backend-v2 run lint`, `npm --prefix backend-v2 run typecheck`, `npm --prefix backend-v2 run test:ci`, and `npm --prefix backend-v2 run build` to prove the slice passes before triggering any Cloud Build.

### Phase 2 – Build A (backend-only deploy)
- From the clean worktree run:
  ```bash
  gcloud builds submit . --config=cloudbuild.yaml \
    --substitutions=_DEPLOY_TARGET=backend,_RUN_MIGRATIONS=false,_RUN_INTEGRATION=false,\
_CLOUDSQL_INSTANCE=<cloud-sql-instance>,_CLOUDSQL_CONNECTION=<project:region:instance>,_BACKEND_SERVICE_ACCOUNT=<service-account>,\
_NEXT_PUBLIC_FIREBASE_API_KEY=<firebase-api-key>,_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<firebase-auth-domain>,\
_NEXT_PUBLIC_FIREBASE_PROJECT_ID=<firebase-project-id>,_GOOGLE_OAUTH_CLIENT_ID=<oauth-client-id>,\
_GOOGLE_OAUTH_REDIRECT_URI=<oauth-redirect-uri>
  ```
- Use the production-grade substitution values for Cloud SQL, Firebase, and OAuth. Do not rely on GitHub triggers or local environment overrides.
- After Build A succeeds, target the new Cloud Run revision for `reserve-api` and verify `/health`, `/ready`, and `GET /api/v1/{tenantKey}/auth/config` (slug requests must never fall through to store-code lookups).

### Phase 3 – Build A gate
- Run `scripts/smoke_public_onboarding.sh` with `RUN_RESERVATION_TEST=true` to cover registration-config, Firebase signup, onboarding register, auth/config, claims sync, onboarding status, booking link, and reservation flows.
- Inspect Cloud Run logs for `invalid input syntax for type uuid: ""`; the tenant middleware regression must not reappear.
- Confirm assignment-table consistency on live DB (menus/options/practitioners vs their assignments) and capture the manual backup / PITR timestamp required for rollback.
- **If any gate fails, abort the same-window release, stick to the backend-only artifacts, and treat Build B/migrations as deferred to the next slice.** This backend-only fallback path leaves the old Cloud Run revision in place and skips `20260312_v3_hard_cleanup.sql`.

### Phase 4 – Build B (migration execution)
- Reuse the same clean worktree and run:
  ```bash
  gcloud builds submit . --config=cloudbuild.yaml \
    --substitutions=_DEPLOY_TARGET=backend,_RUN_MIGRATIONS=true,_RUN_INTEGRATION=false,\
_CLOUDSQL_INSTANCE=<cloud-sql-instance>,_CLOUDSQL_CONNECTION=<project:region:instance>,_BACKEND_SERVICE_ACCOUNT=<service-account>,\
_NEXT_PUBLIC_FIREBASE_API_KEY=<firebase-api-key>,_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<firebase-auth-domain>,\
_NEXT_PUBLIC_FIREBASE_PROJECT_ID=<firebase-project-id>,_GOOGLE_OAUTH_CLIENT_ID=<oauth-client-id>,\
_GOOGLE_OAUTH_REDIRECT_URI=<oauth-redirect-uri>
  ```
- Build B uses the same Cloud Build path with `_RUN_MIGRATIONS=true` so `scripts/run_migrations_cloudbuild.sh` runs the `20260312_v3_hard_cleanup.sql` migration under the guardrails. Do not substitute raw `psql` commands.
- After completion verify `schema_migrations` contains `20260312_v3_hard_cleanup.sql` with the expected checksum and that no legacy columns remain.

### Phase 5 – Post-cutover validation
- Re-run `scripts/smoke_public_onboarding.sh` and add any admin reservation/booking smoke scripts to re-exercise the same customer journeys.
- Confirm Cloud Run request logs show error rates and P95 latencies within the guardrail thresholds documented in `docs/runbooks/DB_MIGRATION_GUARDRAILS.md`.
- Double-check live DB (missing legacy columns/triggers, RLS still enforced, `app_user.rolbypassrls=false`) and record the final Go/No-Go decision with timestamp in this file.

### Firestore helper status
- `backend-v2/scripts/migrate_firestore_to_pg.ts` is undergoing independent investigation. The helper still depends on legacy columns (`store_ids`, `practitioner_ids`, `applicable_menu_ids`, and reservation `period/date/start_time/end_time` fields), so improvements must land in a later release slice once the clean schema is live. The runbook explicitly excludes it from this production release and logs the investigation findings separately.

## 4. Rollback Strategy
- **Build A failure:** revert to the previous Cloud Run revision for `reserve-api`/`reserve-admin`/`reserve-customer`. No schema changes are involved.
- **Build B failure:** restore the Cloud SQL instance via PITR/restore using the timestamp recorded during the Phase 3 gate. Rolling back only the application revision is insufficient because the schema cleanup is irreversible without a restore.

## 5. Next Steps
- Merge the Phase 0 hardening commits, re-run the clean-tree quality gates, and only then mark this document Go with the updated timestamp.
- Once Go is confirmed, rerun the full Phase 2–5 sequence in the release worktree, collect the final evidence, and document every gate result here.
- Keep all production facts in this file; do not duplicate live-state observations back into the static architecture docs.
