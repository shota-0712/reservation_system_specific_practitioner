# DB V3 スキーマ定義（Cloud SQL / PostgreSQL）

**Canonical basis**

- `database/schema/001_initial_schema.sql` (fresh v3-clean bootstrap)
- migrations through `20260312_v3_hard_cleanup.sql` (assignment tables, CRM extension, legacy column removal)

**Live DB delta (2026-03-17)**

- `schema_migrations` currently records `20260311_mt_wave1_rls_hardening.sql` as the latest applied file; `20260312_v3_hard_cleanup.sql` is pending.
- Legacy array columns (`practitioners.store_ids`, `menus.practitioner_ids`, `menu_options.applicable_menu_ids`, `admins.store_ids`) still exist on the live database and are cleaned up only by the pending migration. The canonical definition in this document assumes the post-`20260312` shape.
- Assignment tables (`*_assignments`) exist in both canonical and live assets, but live data may still retain the legacy arrays for downlevel tooling insights.

更新日時: 2026-03-17 JST
対象 migration:

- `20260305_rfm_thresholds.sql`（CRM拡張: `tenant_rfm_settings`）
- `20260306_v3_core_normalization_and_exports.sql`（core tables、tenant-safe FK、exports）
- `20260307_export_jobs_gcs_storage.sql`（export_jobs：GCS storage column + indexes）
- `20260309_tenant_notification_settings.sql`（CRM拡張: `tenant_notification_settings`）
- `20260310_booking_link_resolve_function.sql`（`resolve_booking_link_token`関数）
- `20260311_mt_wave1_rls_hardening.sql`（RLS/permission hardening + helper functions）
- `20260312_v3_hard_cleanup.sql`（legacy column + trigger cleanup）

## 1. 目的

- DB V3 の正本カラム、制約、RLS 方針を API 実装と同じ解像度で明文化すること。
- 正規化済みの assignment テーブルと CRM 拡張を含む最新 ERD/図資産（`DB_V3_ERD.md`, `DB_V3_SCHEMA_DIAGRAM.md`, `DB_V3_SCHEMA_DAG.md`）へのナビゲーションを提供すること。

## 2. 中核テーブル（V3 canonical）

この節では `database/schema/001_initial_schema.sql`+上記 migration で確定したテーブルを列挙する。

### 2.1 `reservations`

- ID/tenant/store/customer/practitioner を tenant-safe で持つ。
- 時間は `starts_at`/`ends_at`/`timezone` の3要素のみ、`period/date/start_time/end_time` は既に削除済み。
- `status` は `pending/confirmed/completed/canceled/no_show`、`source` は `line/phone/walk_in/salonboard/hotpepper/web/admin/google_calendar`。
- `reservations_no_overlap_v3` (GIST + `status NOT IN ('canceled','no_show')`) による排他制約。
- Tenant-safe FK: `(tenant_id, store_id)` → `stores`, `(tenant_id, customer_id)` → `customers`, `(tenant_id, practitioner_id)` → `practitioners`。

#### 支援テーブル

- `reservation_menus`/`reservation_options` はそれぞれ `menu_option` 中間明細で、`tenant_id` を含む FK を持ち RLS を強制。

### 2.2 Assignment テーブル

- `practitioner_store_assignments`, `menu_practitioner_assignments`, `option_menu_assignments`, `admin_store_assignments` を v3-clean の正本とし、legacy array 列（`store_ids`, `practitioner_ids`, `applicable_menu_ids`）は `20260312_v3_hard_cleanup.sql` にて完全削除。
- すべて `tenant_id` を含む複合 PK で tenant-safe FK を定義。

### 2.3 `customers` / `admins` / `practitioners` / `menus` / `menu_options`

- `customer` は RFM/LINE/CRM フィールドを備え、`total_visits`/`total_spend` などの集計カラムを持つ。
- `admins` は Firebase UID + 権限 JSONB を持ち `tenant_id` を通した RLS を強制。
- `practitioners` は `schedule`/`availableMenuIds` を assignment テーブルへ移行済み。`nomination_fee`/`lineConfig` を保持。
- `menus` は `category`/`display_order`/`attributes` を持ち、`menu_practitioner_assignments` で施術者を紐づける。未割当メニューは全施術者（assignment row なし）を意味する。
- `menu_options` は `option_menu_assignments` でメニューと繋がる。未割当オプションはすべてのメニューを対象として扱う。

### 2.4 `booking_link_tokens`

- `token` → `tenant/store/practitioner` を解決する `resolve_booking_link_token(text)` をセットアップ。
- `practitioner_id` を必須にし、`status` (active/revoked) + `expires_at` を持つ。

### 2.5 `settings`, `tenant_rfm_settings`, `tenant_notification_settings`

- `settings` は `tenant_id`/`store_id` 単位でブランディングや通知テンプレートを保持。
- CRM: `tenant_rfm_settings`, `tenant_notification_settings` はそれぞれ `tenant_id` UNIQUE で RLS が `app.current_tenant` を参照。また `20260311_mt_wave1_rls_hardening.sql` で `FORCE ROW LEVEL SECURITY` となる。

### 2.6 `export_jobs`

- CSV エクスポートを表し、`export_type`/`format`/`storage_type` に CHECK 制約。
- `gcs_bucket`/`gcs_object_path` + `download_url_expires_at` は GCS 連携用（`20260307_export_jobs_gcs_storage.sql` で追加）。

## 3. Tenant-safe FK 方針

- `UNIQUE (tenant_id, id)` を親テーブルに追加し、子テーブルは `(tenant_id, xxx_id)` で参照。
- 代表: `reservations`, `reservation_menus`, `reservation_options`, `kartes`, `booking_link_tokens`, `export_jobs`, `service_message_logs`, `google_calendar_sync_tasks`.

## 4. RLS / 権限

- すべての業務テーブルで `ENABLE + FORCE ROW LEVEL SECURITY`。
- policy は `tenant_id = current_setting('app.current_tenant', true)::UUID` で `USING`/`WITH CHECK`。
- `app_user` は `BYPASSRLS` 禁止で、`migration_user` が ddl を実行。

## 5. 運用への注意

- Repository/Service 側は `DatabaseService` を通じて `tenantId` を transation ごとに `SET LOCAL app.current_tenant`。
- 予約操作は `starts_at`/`ends_at` を正本として扱い、`EXCLUDE ...` で競合を防ぐ。
- `resolve_active_store_context` は `store_code` → `tenant_id`/`store_id`、`resolve_booking_link_token` は token から `tenant_id/store_id/practitioner_id` を返す。

## 6. CRM 拡張テーブル

- `tenant_rfm_settings`: threshold scores × 4段階、`tenant_id` UNIQUE。`20260305_rfm_thresholds.sql + 20260311_mt_wave1_rls_hardening.sql` にて定義。
- `tenant_notification_settings`: email/line/push のフラグ群。
- いずれも `updated_at`/`updated_by` を持ち、role-based UI から参照。

## 7. Schema 図資産

- 最新の ER 図: `docs/architecture/DB_V3_ERD.md`
- ハイレベルな領域図: `docs/architecture/DB_V3_SCHEMA_DIAGRAM.md`
- 依存 DAG: `docs/architecture/DB_V3_SCHEMA_DAG.md`

## 8. 監査／実行ユーザー

- migrations は `migration_user`、アプリ実行は `app_user`。`app_user` に `BYPASSRLS` があれば `ALTER ROLE ... NOBYPASSRLS` を強制。
