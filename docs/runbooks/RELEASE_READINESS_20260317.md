# Release Readiness Report

更新日時: 2026-03-20 JST (Historical snapshot; final Go recorded)

> Historical note: this file preserves the same-window release decision executed between 2026-03-18 and 2026-03-20 JST. Current canonical DB state and live verification procedure are `docs/architecture/DB_V3_SCHEMA_DEFINITION.md` and `docs/runbooks/DB_V3_COMPLETENESS_AUDIT.md`.

## Purpose
- This is the historical Go/No-Go runbook for the same-window release. Architecture docs under `docs/architecture` remain the authoritative design reference; this file captures the point-in-time live production state, release history, and hardening timeline used during that cutover.
- The runbook’s target scope was limited to backend fixes, repository/DB hardening, migration guardrails, and supporting release instructions. Statements tied to earlier dates in this file should be read as historical evidence, not as the current DB source of truth.

## 1. Same-Window Phase
- **判定: Go.** Phase 0 hardening complete. All four checklist items confirmed ✅. Quality gates pass (lint / typecheck / 110 tests / build). Release may proceed to Phase 1.
- **Phase 0 hardening guardrails (all confirmed ✅ 2026-03-18):**
  1. ✅ Assignment tables become the only supported relationships for menus/options/practitioners, and repository code propagates `42P01` instead of falling back to legacy array columns. (`fail-fast` tests: 7 cases in `repository.assignment-schema.test.ts`)
  2. ✅ The runbook preflight for `20260312_v3_hard_cleanup.sql` captures four legacy checks (menus.practitioner_ids vs assignments, menu_options.applicable_menu_ids vs assignments, practitioner_store_assignments, and the existing admin store check) plus guardrail `SET LOCAL lock_timeout = '5s'` and `statement_timeout = '15min'`; the migration file itself remains immutable.
  3. ✅ `database/seeds/001_dev_seed.sql` targets the v3 schema (assignment tables, `starts_at`/`ends_at`, timezone-aware reservations) and `docs/runbooks/DB_MIGRATION_GUARDRAILS.md` documents the timeout waiver approval process and PITR-only rollback requirement.
  4. ✅ This runbook and any related release notes clearly state that the Firestore migration helper is not part of the current production cutover; its investigation output feeds the next release slice.
- Same-window proceeds only after Phase 0 edits merge, backend quality gates pass in a clean worktree, and this document is marked Go with the date/time updated here.

## 1b. Phase 1 Gate Results (2026-03-18)

Clean worktree: `/Users/shotahorie/dev/github/shota-0712/reservation_system_practitioner_same_window_clean` (based on `origin/main` efa0666 + Phase 0 cherry-pick d217ef3 + PractitionerRepository tests 8217188)

| Gate | Command | Result |
|------|---------|--------|
| lint | `npm --prefix backend-v2 run lint` | ✅ errors 0 |
| typecheck | `npm --prefix backend-v2 run typecheck` | ✅ exit 0 |
| test:ci | `npm --prefix backend-v2 run test:ci` | ✅ 104 pass / 6 skip / 0 fail (110 total) |
| build | `npm --prefix backend-v2 run build` | ✅ dist/ generated, exit 0 |

**Phase 1 判定: Go ✅ — Phase 2 (Build A) へ進んでよい。**

## 2. Initial Live-State Facts (Pre-cutover 2026-03-17)

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

### Firestore helper status (historical gate note)
- At this release gate, `backend-v2/scripts/migrate_firestore_to_pg.ts` was intentionally excluded from the production cutover scope.
- Current state is different: as of 2026-03-20 the helper has been updated for the v3-clean schema and no longer depends on the legacy array columns or reservation `period/date/start_time/end_time` write path. That change is outside the historical cutover scope captured in this file.

## 4. Rollback Strategy
- **Build A failure:** revert to the previous Cloud Run revision for `reserve-api`/`reserve-admin`/`reserve-customer`. No schema changes are involved.
- **Build B failure:** restore the Cloud SQL instance via PITR/restore using the timestamp recorded during the Phase 3 gate. Rolling back only the application revision is insufficient because the schema cleanup is irreversible without a restore.

## 5. Operator Execution Runbook (Phase 2–5)

**前提:** Phase 1 Gate PASS 済み（§1b 参照）。以下をすべて手動で実行する。

### 5-0. 環境変数収集（Phase 2 実行前に必須）

```bash
# Cloud SQL 接続情報
gcloud sql instances list --project=keyexpress-reserve
gcloud sql instances describe reservation-system-db \
  --project=keyexpress-reserve \
  --format='value(connectionName)'
# → _CLOUDSQL_INSTANCE=reservation-system-db
# → _CLOUDSQL_CONNECTION=keyexpress-reserve:asia-northeast1:reservation-system-db

# Cloud Run サービスアカウント
gcloud run services describe reserve-api \
  --region=asia-northeast1 --project=keyexpress-reserve \
  --format='value(spec.template.spec.serviceAccountName)'
# → _BACKEND_SERVICE_ACCOUNT=<sa-email>

# 現在の本番 URL（ロールバック時の前 revision 確認用）
BACKEND_URL=$(gcloud run services describe reserve-api \
  --region=asia-northeast1 --project=keyexpress-reserve \
  --format='value(status.url)')
echo "BACKEND_URL=${BACKEND_URL}"

# Firebase / OAuth 値は Firebase Console / GCP Console から取得し以下に記入:
# _NEXT_PUBLIC_FIREBASE_API_KEY=<key>
# _NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com
# _NEXT_PUBLIC_FIREBASE_PROJECT_ID=keyexpress-reserve
# _GOOGLE_OAUTH_CLIENT_ID=<oauth-client-id>
# _GOOGLE_OAUTH_REDIRECT_URI=<backend-url>/auth/google/callback
```

### 5-1. Phase 2 — Build A（マイグレーションなし）

```bash
CLEAN=/Users/shotahorie/dev/github/shota-0712/reservation_system_practitioner_same_window_clean
cd "${CLEAN}"

gcloud builds submit . \
  --project=keyexpress-reserve \
  --config=cloudbuild.yaml \
  --substitutions=\
_DEPLOY_TARGET=backend,\
_RUN_MIGRATIONS=false,\
_RUN_INTEGRATION=false,\
_REGION=asia-northeast1,\
_DB_USER=migration_user,\
_DB_NAME=reservation_system,\
_DB_PASSWORD_SECRET=db-password-migration,\
_BACKEND_SERVICE=reserve-api,\
_CLOUDSQL_INSTANCE=reservation-system-db,\
_CLOUDSQL_CONNECTION=keyexpress-reserve:asia-northeast1:reservation-system-db,\
_BACKEND_SERVICE_ACCOUNT=<SA_EMAIL>,\
_NEXT_PUBLIC_FIREBASE_API_KEY=<FIREBASE_API_KEY>,\
_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<FIREBASE_AUTH_DOMAIN>,\
_NEXT_PUBLIC_FIREBASE_PROJECT_ID=keyexpress-reserve,\
_GOOGLE_OAUTH_CLIENT_ID=<OAUTH_CLIENT_ID>,\
_GOOGLE_OAUTH_REDIRECT_URI=<BACKEND_URL>/auth/google/callback
```

**Build A Gate 確認:**
```bash
BACKEND_URL=$(gcloud run services describe reserve-api \
  --region=asia-northeast1 --project=keyexpress-reserve \
  --format='value(status.url)')
curl -sf "${BACKEND_URL}/health" | jq .
curl -sf "${BACKEND_URL}/ready" | jq .
# 期待: ready=true, status=ok
```

**Build A ロールバック（失敗時）:**
```bash
# 前 revision を確認
gcloud run revisions list --service=reserve-api \
  --region=asia-northeast1 --project=keyexpress-reserve \
  --format='value(name)' | head -3
# 前 revision に 100% 戻す
gcloud run services update-traffic reserve-api \
  --region=asia-northeast1 --project=keyexpress-reserve \
  --to-revisions=<PREV_REVISION>=100
```

### 5-2. Phase 3 — Build A Gate Smoke

**STEP 1: PITR タイムスタンプ記録（Phase 4 前に必須）**
```bash
PITR_TS=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
echo "PITR_TIMESTAMP=${PITR_TS}"
# この値を §6（Phase 4 記録）に記入する
```

**STEP 2: Smoke 実行**
```bash
API_URL="${BACKEND_URL}" \
FIREBASE_API_KEY="<FIREBASE_API_KEY>" \
RUN_RESERVATION_TEST=true \
./scripts/smoke_public_onboarding.sh
# 期待: exit 0
```

**STEP 3: UUID エラー回帰チェック**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="reserve-api"
   AND textPayload:"invalid input syntax for type uuid"' \
  --project=keyexpress-reserve \
  --freshness=15m --limit=20
# 期待: 0 件
```

**Phase 3 Gate 判定:**
- smoke exit 0 ✅ / UUID エラー 0 件 ✅ / PITR 記録済み ✅ → Phase 4 へ
- いずれか NG → Phase 4 中止、Build A revision 維持

### 5-3. Phase 4 — Build B（Migration 実行、不可逆）

**前提:** Phase 3 Gate 全 PASS かつ PITR タイムスタンプ記録済み

```bash
cd "${CLEAN}"

gcloud builds submit . \
  --project=keyexpress-reserve \
  --config=cloudbuild.yaml \
  --substitutions=\
_DEPLOY_TARGET=backend,\
_RUN_MIGRATIONS=true,\
_RUN_INTEGRATION=false,\
_REGION=asia-northeast1,\
_DB_USER=migration_user,\
_DB_NAME=reservation_system,\
_DB_PASSWORD_SECRET=db-password-migration,\
_BACKEND_SERVICE=reserve-api,\
_CLOUDSQL_INSTANCE=reservation-system-db,\
_CLOUDSQL_CONNECTION=keyexpress-reserve:asia-northeast1:reservation-system-db,\
_BACKEND_SERVICE_ACCOUNT=<SA_EMAIL>,\
_NEXT_PUBLIC_FIREBASE_API_KEY=<FIREBASE_API_KEY>,\
_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<FIREBASE_AUTH_DOMAIN>,\
_NEXT_PUBLIC_FIREBASE_PROJECT_ID=keyexpress-reserve,\
_GOOGLE_OAUTH_CLIENT_ID=<OAUTH_CLIENT_ID>,\
_GOOGLE_OAUTH_REDIRECT_URI=<BACKEND_URL>/auth/google/callback
```

**Build B ロールバック（PITR 必要な場合）:**
```bash
gcloud sql instances clone reservation-system-db reservation-system-db-rollback \
  --point-in-time="<PITR_TIMESTAMP_FROM_PHASE_3>" \
  --project=keyexpress-reserve
```

### 5-4. Phase 5 — Post-Cutover Validation

**STEP 1: Smoke 再実行**
```bash
API_URL="${BACKEND_URL}" \
FIREBASE_API_KEY="<FIREBASE_API_KEY>" \
RUN_RESERVATION_TEST=true \
./scripts/smoke_public_onboarding.sh
# 期待: exit 0
```

**STEP 2: Legacy column 消滅確認（Cloud SQL Proxy 経由）**
```bash
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
    );"
# 期待: 0 rows
```

**STEP 3: エラー率確認**
```bash
gcloud logging read \
  "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"reserve-api\" \
   AND logName=\"projects/keyexpress-reserve/logs/run.googleapis.com%2Frequests\" \
   AND httpRequest.requestUrl:\"/api/v1/\"" \
  --project=keyexpress-reserve --limit=2000 --format=json \
  | jq '[.[] | {s: .httpRequest.status}] |
        {total: length, err: [.[] | select(.s >= 500)] | length} |
        .rate = (.err / .total * 100)'
# 判定基準: rate < 2.0%
```

**STEP 4: schema_migrations 確認**
```bash
psql -h 127.0.0.1 -U migration_user -d reservation_system -c "
  SELECT filename, applied_at
  FROM schema_migrations
  WHERE filename LIKE '20260312%'
  ORDER BY applied_at;"
# 期待: 20260312_v3_hard_cleanup.sql が 1 行
```

### 5-5. Worktree クリーンアップ（Phase 5 完了後）

```bash
git worktree remove --force \
  /Users/shotahorie/dev/github/shota-0712/reservation_system_practitioner_same_window_clean
```

## 6. Release Evidence Log（実行時に記入）

| 項目 | 値 |
|------|----|
| Phase 1 Gate | ✅ 2026-03-18 (104 pass / 6 skip / 0 fail) |
| Phase 2 Build ID | `94a5b6dc` |
| Phase 3 PITR Timestamp | `2026-03-19T07:16:26Z` |
| Phase 3 Smoke | `PASS (8/8, exit 0)` |
| Phase 3 UUID errors | `0 hits/15m` |
| Phase 4 Build ID | `4c1600d4-ceab-456a-a796-cef694c67434` |
| Phase 5 Smoke | `PASS (8/8, exit 0; tenantSlug=smoke-salon-1773932588)` |
| Phase 5 Legacy columns | `none; schema_migrations=20260312_v3_hard_cleanup.sql; FORCE RLS ok; app_user rolbypassrls=false` |
| Phase 5 Error rate | `total=9 err=0 rate=0.00%; baseline_p95=352.770456ms (latest available /api/v1/ sample, 24h); post_p95=285.705299ms` |
| 最終 Go/No-Go | `Go 2026-03-20 00:04:35 JST` |

## 7. 2026-03-22 DB V3 Remediation Addendum

This addendum records the later live DB remediation slice that closed the remaining DB V3 drift. The historical same-window release decision above is unchanged; current canonical evidence remains `docs/runbooks/DB_V3_COMPLETENESS_AUDIT.md`.

- Initial remediation build: `08291474-b22c-4f75-90e8-96ac541c860c`
  - Executed through the same Cloud Build path with `_RUN_MIGRATIONS=true`
  - Applied forward migrations `20260313_salonboard_hardening.sql`, `20260322_tenant_google_calendar_oauth_rls.sql`, and `20260323_audit_logs_force_rls.sql`
  - Failed only because repo `20260312_v3_hard_cleanup.sql` did not match the already-applied live checksum
- Applied checksum source of truth:
  - Historical successful Build B archive `4c1600d4-ceab-456a-a796-cef694c67434`
  - Source object `gs://keyexpress-reserve_cloudbuild/source/1773932233.409144-f81674d6e03845f89478c749c4a285bb.tgz`
  - `20260312_v3_hard_cleanup.sql` checksum recovered from that archive: `aec27f0be1fa2eabe97eaca4d85bb67592b47defffe03dbfcb0b7fb4ff4663c7`
- Retry build: `d28e0ba4-efe3-4df4-abeb-0cc36f6f6dbb`
  - Result: `SUCCESS`
  - Finish time: `2026-03-22 17:33:45 JST`
  - Deployed revision: `reserve-api-00048-kw4`
- Final live audit:
  - Command path: `bash scripts/run_db_completeness_audit.sh live`
  - Artifact: `scripts/out/db_completeness_audit/live/20260322T083420Z`
  - Result: `PASS`
  - `missing_repo_migrations=(none)`
  - `checksum_mismatches=(none)`
  - `audit_logs`, `tenant_google_calendar_oauth`, `tenant_salonboard_config`: all `rls_enabled=t`, `force_rls=t`
  - `/health` PASS, `/ready` PASS, public onboarding smoke PASS
  - Request logs: `reserve-api total=300 five_xx=0 error_rate=0.00% uuid_hits=0`

Current DB completeness decision:

- `GO` for the DB V3 live remediation slice as of `2026-03-22 17:34 JST`.
- Use `docs/runbooks/DB_V3_COMPLETENESS_AUDIT.md` §6.3 as the final evidence pointer.
