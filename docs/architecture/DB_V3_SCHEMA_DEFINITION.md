# DB V3 スキーマ定義（Cloud SQL / PostgreSQL）

更新日時: 2026-03-05 JST  
対象 migration:

- `database/migrations/20260306_v3_core_normalization_and_exports.sql`
- `database/migrations/20260307_export_jobs_gcs_storage.sql`

## 1. 目的

- DB V3 の正本カラム、制約、RLS 方針を API 実装と同じ解像度で明文化する。
- ER 図の補助として、運用時に参照できる「定義書」を持つ。

ER 図は以下を参照:

- `docs/architecture/DB_V3_ERD.md`

## 2. 中核テーブル定義（V3）

### 2.1 reservations（時間正本化）

主要カラム:

- `id uuid PK`
- `tenant_id uuid NOT NULL`
- `store_id uuid NULL`
- `customer_id uuid NOT NULL`
- `practitioner_id uuid NOT NULL`
- `starts_at timestamptz NOT NULL`
- `ends_at timestamptz NOT NULL`
- `timezone varchar(50) NOT NULL default 'Asia/Tokyo'`
- `date date`
- `start_time time`
- `end_time time`
- `status varchar`

主要制約:

- `CHECK (starts_at < ends_at)` (`reservations_starts_before_ends`)
- 予約重複防止:
  - `EXCLUDE USING GIST (tenant_id WITH =, practitioner_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)`
  - 条件: `status NOT IN ('canceled', 'no_show')`
  - 制約名: `reservations_no_overlap_v3`
- tenant-safe FK:
  - `(tenant_id, store_id) -> stores(tenant_id, id)`
  - `(tenant_id, customer_id) -> customers(tenant_id, id)`
  - `(tenant_id, practitioner_id) -> practitioners(tenant_id, id)`

補助トリガー:

- `sync_reservation_time_fields_trigger`
  - `starts_at/ends_at/timezone` と `date/start_time/end_time/period` の同期
- `enforce_reservation_status_transition_trigger`
  - status 遷移を DB で強制

### 2.2 assignment テーブル群（多対多正規化）

#### practitioner_store_assignments

- PK: `(tenant_id, practitioner_id, store_id)`
- FK:
  - `(tenant_id, practitioner_id) -> practitioners(tenant_id, id)`
  - `(tenant_id, store_id) -> stores(tenant_id, id)`

#### menu_practitioner_assignments

- PK: `(tenant_id, menu_id, practitioner_id)`
- FK:
  - `(tenant_id, menu_id) -> menus(tenant_id, id)`
  - `(tenant_id, practitioner_id) -> practitioners(tenant_id, id)`

#### option_menu_assignments

- PK: `(tenant_id, option_id, menu_id)`
- FK:
  - `(tenant_id, option_id) -> menu_options(tenant_id, id)`
  - `(tenant_id, menu_id) -> menus(tenant_id, id)`

#### admin_store_assignments

- PK: `(tenant_id, admin_id, store_id)`
- FK:
  - `(tenant_id, admin_id) -> admins(tenant_id, id)`
  - `(tenant_id, store_id) -> stores(tenant_id, id)`

### 2.3 export_jobs（CSVエクスポート）

主要カラム:

- `id uuid PK`
- `tenant_id uuid NOT NULL`
- `store_id uuid NULL`
- `export_type varchar(50) NOT NULL`
- `format varchar(10) NOT NULL default 'csv'`
- `params jsonb NOT NULL default '{}'::jsonb`
- `status varchar(20) NOT NULL default 'queued'`
- `csv_content text NULL`
- `storage_type varchar(20) NOT NULL default 'inline'`
- `gcs_bucket text NULL`
- `gcs_object_path text NULL`
- `download_url_expires_at timestamptz NULL`

主要制約:

- `export_type IN (...)`
  - `operations_reservations`
  - `operations_customers`
  - `analytics_store_daily_kpi`
  - `analytics_menu_performance`
- `format IN ('csv')`
- `status IN ('queued','running','completed','failed')`
- `storage_type IN ('inline','gcs')` (`export_jobs_storage_type_check`)
- tenant-safe FK:
  - `(tenant_id, store_id) -> stores(tenant_id, id)`

## 3. tenant-safe FK 方針

V3 では「ID 単独 FK」を段階的に排し、以下を正本とする。

- 親テーブルに `UNIQUE (tenant_id, id)` を追加
- 子テーブル参照を `FOREIGN KEY (tenant_id, xxx_id) REFERENCES parent(tenant_id, id)` に統一

適用対象（代表）:

- `reservations`
- `reservation_menus`
- `reservation_options`
- `kartes`
- `booking_link_tokens`
- `google_calendar_sync_tasks`
- `service_message_logs`
- `export_jobs`

## 4. RLS / 権限

RLS 対象:

- 業務テーブルは `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`
- policy は原則:
  - `USING (tenant_id = current_setting('app.current_tenant', true)::uuid)`
  - `WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)`

アプリロール要件:

- `app_user` は `BYPASSRLS` を持ってはいけない
- migration で `ALTER ROLE app_user NOBYPASSRLS` を試行し、解除不能なら失敗させる

## 5. API 実装との整合ポイント

- Repository からの DB アクセスは `DatabaseService.query/queryOne/transaction(..., tenantId)` を使用し tenant context を設定
- 予約作成/更新は `starts_at/ends_at` を正本として更新
- 予約重複の競合判定は DB の exclusion 制約（`23P01`）と API 409 変換で整合

## 6. 監査参照

- Phase A 監査:
  - `docs/runbooks/DB_V3_PHASE_A_AUDIT.md`
- Phase B 実行ログ:
  - `docs/runbooks/DB_V3_PHASE_B_EXECUTION_LOG.md`
