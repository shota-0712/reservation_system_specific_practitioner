# DB V3 Capability Matrix

更新日時: 2026-03-22 JST

## Canonical Scope

- SQL 正本: `database/schema/001_initial_schema.sql`
- 進化経路: `database/migrations/*.sql`
- 人間向け正本: 本書 + `docs/architecture/DB_V3_SCHEMA_DEFINITION.md`
- ステータス意味:
  - `verified`: schema + code path + test / smoke 根拠あり
  - `partial`: schema + code path はあるが、test depth または live smoke が不足
  - `unverified`: テーブルはあるが、read/write path または検証が薄い
  - `ops`: 運用メタデータ。アプリ機能ではなく cutover 監査対象
- upgrade-only retained artifact:
  - `id_mappings` は fresh bootstrap の canonical 28 tables には含めない
  - upgraded/live DB では履歴参照用に残っていてよく、completeness blocker ではない

## Feature Matrix

| Feature | Status | Covered tables | Key constraints / RLS | Primary read/write path | Tests / evidence | Remaining gap / note |
|---|---|---|---|---|---|---|
| Tenant / Auth foundation | `partial` | `tenants`, `stores`, `admins`, `admin_store_assignments` | `stores` / `admins` / `admin_store_assignments` は `ENABLE + FORCE RLS`。`resolve_active_store_context(text)` が strict-RLS-safe tenant resolution。`tenants` は canonical 上の non-RLS exception。 | `backend-v2/src/middleware/tenant.ts`, `backend-v2/src/middleware/auth.ts`, `backend-v2/src/routes/platform/onboarding.routes.ts` | `backend-v2/tests/unit/tenant.middleware.test.ts`, `backend-v2/tests/unit/auth.middleware.test.ts`, `backend-v2/tests/unit/onboarding.service.test.ts`, `backend-v2/tests/integration/auth.routes.test.ts`, `docs/runbooks/DB_V3_FEATURE_VERIFICATION.md` | `tenants` の RLS 例外は schema change ではなく audit result として残す。status 昇格は live automated evidence を `DB_V3_FEATURE_VERIFICATION.md` に転記後。 |
| Catalog / Staff | `partial` | `practitioners`, `menus`, `menu_options`, `practitioner_store_assignments`, `menu_practitioner_assignments`, `option_menu_assignments` | catalog/staff 向け assignment 3表は複合 PK + tenant-safe FK + `FORCE RLS`。legacy arrays は canonical では対象外。 | `backend-v2/src/repositories/practitioner.repository.ts`, `backend-v2/src/repositories/menu.repository.ts`, `backend-v2/src/repositories/option.repository.ts`, `backend-v2/src/routes/v1/assignment.admin.routes.ts`, `backend-v2/scripts/migrate_firestore_to_pg.ts` | `backend-v2/tests/unit/repository.assignment-schema.test.ts`, `backend-v2/tests/integration/assignment.admin.routes.test.ts`, `docs/runbooks/DB_V3_FEATURE_VERIFICATION.md` | live automated assignment round-trip と public read-path evidence を runbook に転記後に `verified`。 |
| Booking | `verified` | `reservations`, `reservation_menus`, `reservation_options` | `starts_at` / `ends_at` / `timezone` が正本。tenant-safe FK + `reservations_no_overlap_v3` + `FORCE RLS`。 | `backend-v2/src/repositories/reservation.repository.ts`, `backend-v2/src/services/reservation.service.ts`, `backend-v2/src/routes/v1/reservation.admin.routes.ts`, `backend-v2/src/routes/v1/reservation.customer.routes.ts`, `backend-v2/src/routes/v1/slot.routes.ts` | `backend-v2/tests/e2e/reservation-flow.test.ts`, `backend-v2/tests/unit/reservation-policy.test.ts`, `backend-v2/tests/unit/reservation-filters.test.ts`, `scripts/smoke_public_onboarding.sh` | live DB への再照会は未実施。次回 cutover 前に checklist を回す。 |
| CRM / Karte | `verified` | `customers`, `kartes`, `karte_templates`, `tenant_rfm_settings` | 全表 `FORCE RLS`。`tenant_rfm_settings` は `tenant_id UNIQUE`。 | `backend-v2/src/repositories/customer.repository.ts`, `backend-v2/src/repositories/karte.repository.ts`, `backend-v2/src/services/rfm-thresholds.service.ts`, `backend-v2/src/routes/v1/karte.admin.routes.ts`, `backend-v2/src/routes/v1/karte-template.admin.routes.ts`, `backend-v2/src/routes/v1/rfm-settings.admin.routes.ts` | `backend-v2/tests/unit/rfm-thresholds.service.test.ts`, `backend-v2/tests/unit/karte.repository.test.ts`, `backend-v2/tests/integration/karte.routes.test.ts` | Live DB migration governance is tracked in `docs/runbooks/DB_V3_COMPLETENESS_AUDIT.md`; current code/schema path is closed. |
| Booking Link | `partial` | `booking_link_tokens` | `FORCE RLS` + `resolve_booking_link_token(text)` (`SECURITY DEFINER`, `EXECUTE app_user`)。`practitioner_id` 必須、`status/expires_at` 管理。 | `backend-v2/src/services/booking-link-token.service.ts`, `backend-v2/src/routes/platform/onboarding.routes.ts`, `scripts/smoke_public_onboarding.sh`, `scripts/prepare_real_line_e2e.sh` | `backend-v2/tests/unit/booking-link-token.service.test.ts`, `scripts/smoke_public_onboarding.sh`, `scripts/prepare_real_line_e2e.sh`, `docs/runbooks/DB_V3_FEATURE_VERIFICATION.md` | `dev-v3` / `live` の real LINE findings を runbook に転記後に `verified`。 |
| Settings / Notifications | `partial` | `settings`, `tenant_notification_settings`, `service_message_logs` | `settings` は `UNIQUE (tenant_id, store_id)` + `FORCE RLS`。`tenant_notification_settings` は `tenant_id UNIQUE` + `FORCE RLS`。`service_message_logs` も `FORCE RLS`。 | `backend-v2/src/routes/v1/settings.routes.ts`, `backend-v2/src/repositories/tenant-notification-settings.repository.ts`, `backend-v2/src/services/service-message.service.ts`, `backend-v2/src/routes/v1/reminder.routes.ts` | `backend-v2/tests/unit/tenant-notification-settings.repository.test.ts`, `backend-v2/tests/unit/service-message.service.test.ts`, `backend-v2/tests/integration/settings.routes.test.ts`, `backend-v2/tests/integration/reminder.routes.test.ts`, `docs/runbooks/DB_V3_FEATURE_VERIFICATION.md` | live reminder success row と real LINE reservation evidence を runbook に転記後に `verified`。 |
| Exports | `verified` | `export_jobs` | `FORCE RLS`。`export_type` / `format` / `storage_type` CHECK 制約、GCS columns あり。 | `backend-v2/src/routes/v1/export.admin.routes.ts`, `backend-v2/src/services/export-job.service.ts` | `backend-v2/tests/unit/export-job.service.test.ts`, `backend-v2/tests/integration/export.routes.test.ts` | Runtime governance remains in the Ops row; feature path itself is covered. |
| Google Calendar | `verified` | `tenant_google_calendar_oauth`, `google_calendar_sync_tasks` | `tenant_google_calendar_oauth` と `google_calendar_sync_tasks` は `ENABLE + FORCE RLS` + tenant isolation。`google_calendar_sync_tasks` は dedupe unique index あり。 | `backend-v2/src/services/google-calendar.service.ts`, `backend-v2/src/services/google-calendar-sync.service.ts`, `backend-v2/src/services/google-calendar-sync-queue.service.ts`, `backend-v2/src/routes/v1/google-calendar.routes.ts`, `backend-v2/src/routes/v1/jobs.admin.routes.ts` | `backend-v2/tests/unit/google-calendar.service.test.ts`, `backend-v2/tests/unit/google-calendar-sync.service.test.ts`, `backend-v2/tests/unit/google-calendar-sync-queue.service.test.ts`, `backend-v2/tests/integration/google-calendar.routes.test.ts` | Live DB remediation closed on 2026-03-22; `tenant_google_calendar_oauth` is now `ENABLE + FORCE RLS` on live as well. |
| Salonboard | `verified` | `tenant_salonboard_config` | `tenant_id UNIQUE` + `ENABLE + FORCE RLS`。`reservations.salonboard_reservation_id` は nullable unique partial index。 | `backend-v2/src/repositories/salonboard.repository.ts`, `backend-v2/src/services/salonboard.service.ts`, `backend-v2/src/routes/v1/salonboard.routes.ts`, `backend-v2/src/routes/v1/jobs.admin.routes.ts`, `backend-v2/src/routes/v1/jobs.routes.ts` | `backend-v2/tests/unit/salonboard.repository.test.ts`, `backend-v2/tests/unit/salonboard.service.test.ts`, `backend-v2/tests/integration/salonboard.routes.test.ts` | Live DB remediation closed on 2026-03-22; `tenant_salonboard_config` is now `ENABLE + FORCE RLS` on live as well. |
| Analytics / Reports / Dashboard | `partial` | `daily_analytics`, `audit_logs` | 両表とも `FORCE RLS`。`daily_analytics` は `UNIQUE (tenant_id, store_id, date)`。 | `backend-v2/src/jobs/daily-analytics.job.ts`, `backend-v2/src/services/reports-aggregation.service.ts`, `backend-v2/src/routes/v1/reports.routes.ts`, `backend-v2/src/services/dashboard-activity.service.ts`, `backend-v2/src/routes/v1/dashboard.routes.ts` | `backend-v2/tests/unit/daily-analytics-job.test.ts`, `backend-v2/tests/integration/jobs.admin.routes.test.ts`, `backend-v2/tests/integration/reports.routes.test.ts`, `backend-v2/tests/integration/dashboard.routes.test.ts`, `backend-v2/tests/unit/reports-aggregation.service.test.ts`, `backend-v2/tests/unit/dashboard-activity.service.test.ts`, `docs/runbooks/DB_V3_FEATURE_VERIFICATION.md` | live analytics job execution + dashboard/report smoke を runbook に転記後に `verified`。 |
| Ops / Migration governance | `ops` | `schema_migrations` | `filename` PK, `version + checksum` immutable pair。non-RLS by design. `status-fresh` / `status` と `run_db_completeness_audit.sh` が canonical proof entrypoint. | `scripts/run_migrations_cloudbuild.sh`, `scripts/db_v3.sh`, `scripts/run_db_completeness_audit.sh`, `docs/runbooks/DB_MIGRATION_GUARDRAILS.md`, `docs/runbooks/DB_V3_COMPLETENESS_AUDIT.md` | Fresh bootstrap audit passed on 2026-03-22; live remediation closed on 2026-03-22 with final PASS evidence in `docs/runbooks/DB_V3_COMPLETENESS_AUDIT.md` §6.3. | Current live status is clean: `missing_repo_migrations=(none)`, `checksum_mismatches=(none)`, expected FORCE RLS is present, and `id_mappings` remains an allowed upgrade-only retained artifact on upgraded/live DBs. |

## Table Coverage Check

| Table | Primary matrix row |
|---|---|
| `tenants` | Tenant / Auth foundation |
| `tenant_google_calendar_oauth` | Google Calendar |
| `tenant_salonboard_config` | Salonboard |
| `stores` | Tenant / Auth foundation |
| `practitioners` | Catalog / Staff |
| `menus` | Catalog / Staff |
| `menu_options` | Catalog / Staff |
| `customers` | CRM / Karte |
| `reservations` | Booking |
| `reservation_menus` | Booking |
| `reservation_options` | Booking |
| `kartes` | CRM / Karte |
| `karte_templates` | CRM / Karte |
| `admins` | Tenant / Auth foundation |
| `daily_analytics` | Analytics / Reports / Dashboard |
| `settings` | Settings / Notifications |
| `schema_migrations` | Ops / Migration governance |
| `audit_logs` | Analytics / Reports / Dashboard |
| `service_message_logs` | Settings / Notifications |
| `google_calendar_sync_tasks` | Google Calendar |
| `booking_link_tokens` | Booking Link |
| `practitioner_store_assignments` | Catalog / Staff |
| `menu_practitioner_assignments` | Catalog / Staff |
| `option_menu_assignments` | Catalog / Staff |
| `admin_store_assignments` | Tenant / Auth foundation |
| `export_jobs` | Exports |
| `tenant_rfm_settings` | CRM / Karte |
| `tenant_notification_settings` | Settings / Notifications |

## Diagram Cross-Check

- `docs/architecture/DB_V3_ERD.md`
- `docs/architecture/DB_V3_SCHEMA_DIAGRAM.md`
- `docs/architecture/DB_V3_SCHEMA_DAG.md`

上記 Mermaid 資産で使っているテーブル名は canonical schema の識別子に一致している。図は overview 用であり、全 28 テーブルの網羅確認と検証ステータスは本書を正本とする。
