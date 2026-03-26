# DB V3 スキーマ定義（Cloud SQL / PostgreSQL）

更新日時: 2026-03-22 JST

## 1. Canonical Sources

- SQL 正本: `database/schema/001_initial_schema.sql`
- 既存 DB の進化経路: `database/migrations/*.sql`
- 人間向け正本:
  - `docs/architecture/DB_V3_SCHEMA_DEFINITION.md`
  - `docs/architecture/DB_V3_CAPABILITY_MATRIX.md`
- Mermaid overview:
  - `docs/architecture/DB_V3_ERD.md`
  - `docs/architecture/DB_V3_SCHEMA_DIAGRAM.md`
  - `docs/architecture/DB_V3_SCHEMA_DAG.md`

## 2. Coverage Summary

- `001_initial_schema.sql` は現行 canonical で **28 tables** を作成する。
- そのうち **26 tables** が tenant-scoped で `ENABLE + FORCE ROW LEVEL SECURITY` を持つ。
- non-RLS exception は次の 2 tables:
  - `tenants`
  - `schema_migrations`
- upgrade-only retained artifact の `id_mappings` は fresh bootstrap では作成せず、upgraded/live DB では残存していても canonical completeness の blocker にしない。
- 全 `CREATE TABLE` の feature mapping / test status / 未検証点は `docs/architecture/DB_V3_CAPABILITY_MATRIX.md` を正本とする。

## 3. Documented Live DB Delta

この節は **2026-03-22 JST の fresh/live audit** を要約する。詳細な証跡と artifact path は `docs/runbooks/DB_V3_COMPLETENESS_AUDIT.md` を正本とする。

- fresh bootstrap (`/tmp/reserve-db-audit-pg-codex`, `reservation_system_audit`) は PASS。
  - 28 tables present
  - `id_mappings` absent
  - legacy columns absent
  - helper functions present with `SECURITY DEFINER` + `EXECUTE app_user`
  - 26 tenant-scoped tables on `ENABLE + FORCE RLS`
  - `app_user.rolbypassrls=false`
- live DB (`reservation-system-db`) は remediation 後に PASS。
  - `id_mappings` は upgrade-only retained artifact として許容される
  - latest applied migration: `20260323_audit_logs_force_rls.sql`
  - `missing_repo_migrations=(none)`
  - `checksum_mismatches=(none)`
  - `unexpected_db_migrations=(none)`
  - legacy columns absent
  - helper functions present
  - FORCE RLS: all expected tenant-scoped tables report `rls_enabled=t`, `force_rls=t`
  - `app_user.rolbypassrls=false`

service-side runtime checks in the same window also passed (`/health`, `/ready`, public onboarding smoke, request-log thresholds). `id_mappings` remains an allowed upgrade-only retained artifact on upgraded/live DBs. The canonical evidence pointer for this closure is `docs/runbooks/DB_V3_COMPLETENESS_AUDIT.md` §6.3.

## 4. Canonical Product Assumptions

### 4.1 Booking / Reservation Core

- `reservations` の正本時間は `starts_at` / `ends_at` / `timezone` のみ。
- 旧互換列 `period/date/start_time/end_time` は fresh bootstrap には存在せず、upgrade path では `20260312_v3_hard_cleanup.sql` が削除する。
- `reservation_menus` / `reservation_options` は tenant-safe child tables として残り、いずれも `FORCE RLS`。
- 競合制御は `reservations_no_overlap_v3` による exclusion constraint が正本。

### 4.2 Catalog / Assignment Normalization

- `practitioner_store_assignments`, `menu_practitioner_assignments`, `option_menu_assignments`, `admin_store_assignments` が唯一の正規リレーション。
- legacy arrays (`practitioners.store_ids`, `menus.practitioner_ids`, `menu_options.applicable_menu_ids`, `admins.store_ids`) は canonical scope では cleanup 済み前提。
- `backend-v2/scripts/migrate_firestore_to_pg.ts` は 2026-03-20 時点で v3-clean schema 前提に更新済みで、assignment tables を直接同期し、legacy array write を行わない。

### 4.3 Tenant Resolution / Booking Link

- `resolve_active_store_context(text)` は strict-RLS-safe な `store_code -> tenant_id/store_id` 解決の唯一の正規経路。
- `resolve_booking_link_token(text)` は token-only public flow の正規解決経路。
- `GET /api/platform/v1/booking-links/resolve` では `tenantKey` は optional hint であり、token-only が成功することを正とする。

### 4.4 CRM / Settings / Notifications / Exports

- `tenant_rfm_settings` と `tenant_notification_settings` は `tenant_id UNIQUE` の tenant extension tables。
- `settings` は `UNIQUE (tenant_id, store_id)` を持つ store-scoped settings 正本。
- `service_message_logs` は通知送信の audit trail、`export_jobs` は export queue / artifact tracking の正本。

### 4.5 Integrations

- Google Calendar は `tenant_google_calendar_oauth` + `google_calendar_sync_tasks` で構成する。
- Salonboard は `tenant_salonboard_config` を config 正本に持ち、業務データ側は `practitioners.salonboard_staff_id` と `reservations.salonboard_reservation_id` を利用する。
- `tenant_google_calendar_oauth` / `tenant_salonboard_config` は tenant-bound な hardened tables として扱い、fresh/live audit で `FORCE ROW LEVEL SECURITY` を必須条件にする。

## 5. RLS / Privileges

- `app_user` は `rolbypassrls=false` が必須。DDL / migration は `migration_user` が実行する。
- `resolve_active_store_context(text)` と `resolve_booking_link_token(text)` は `SECURITY DEFINER` で、`app_user` に `EXECUTE` が付与される前提。
- `FORCE RLS` を「全 tables」と曖昧化しない。正しい表現は **26 tenant-scoped tables に FORCE RLS、2 exception tables は matrix で明示管理**。`id_mappings` は upgrade-only retained artifact なので completeness 判定の blocker ではない。
- tenant-safe FK の代表例:
  - `reservations (tenant_id, store_id) -> stores`
  - `reservations (tenant_id, customer_id) -> customers`
  - `reservations (tenant_id, practitioner_id) -> practitioners`
  - assignment tables / `booking_link_tokens` / `export_jobs` / `google_calendar_sync_tasks` も同様

## 6. Diagram Assets

- `docs/architecture/DB_V3_ERD.md`
- `docs/architecture/DB_V3_SCHEMA_DIAGRAM.md`
- `docs/architecture/DB_V3_SCHEMA_DAG.md`

これらの図で使うテーブル名は canonical schema の識別子に一致する。ただし図は overview asset であり、全 28 tables の網羅確認や検証ステータスの正本ではない。exhaustive coverage は `docs/architecture/DB_V3_CAPABILITY_MATRIX.md` を参照する。

## 7. Live Verification Source

- 正式 runbook は `docs/runbooks/DB_V3_COMPLETENESS_AUDIT.md`
- 推奨コマンドは `bash scripts/db_v3.sh status-fresh` と `bash scripts/db_v3.sh status`
- live DB が canonical とズレた場合の記録ルール:
  - `missing_repo_migrations=(none)` でなければ、欠けている filename をそのまま記録する
  - helper function / RLS / role flag の差分は object 名と observed value を残す
