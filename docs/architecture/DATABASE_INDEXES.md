# Database Indexes 設計（PostgreSQL）

**バージョン**: 2.1.0
**最終更新日**: 2026-01-31
**ステータス**: Active

## 目的

このドキュメントは **PostgreSQL（Cloud SQL）** におけるインデックス設計を定義する。
RLS（Row Level Security）と併用し、**高トラフィック環境でも高速な検索と集計**を担保する。

## 関連ドキュメント

- [MULTI_TENANT_ARCHITECTURE.md](./MULTI_TENANT_ARCHITECTURE.md)
- [SECURITY_AND_URL_DESIGN.md](./SECURITY_AND_URL_DESIGN.md)
- [ANALYTICS_DESIGN.md](./ANALYTICS_DESIGN.md)
- [database/schema/001_initial_schema.sql](../../database/schema/001_initial_schema.sql)

---

## インデックス設計の原則

1. **読取りパターン優先**: 予約検索・顧客検索・分析を最優先
2. **書込みコスト管理**: 不要なインデックスは作らない
3. **部分インデックス活用**: `is_active` 等の条件付きで絞り込み
4. **GIN / GiST**: JSONB・配列・範囲型の検索に最適化

---

## 現在の主要インデックス（スキーマ準拠）

### テナント/店舗
- `tenants`: `idx_tenants_slug`
- `stores`: `idx_stores_tenant`（`store_code` は UNIQUE 制約で索引化）

### スタッフ/メニュー
- `practitioners`: `idx_practitioners_tenant`, `idx_practitioners_active`
- `menus`: `idx_menus_tenant`, `idx_menus_active`, `idx_menus_category`
- `menu_options`: `idx_menu_options_tenant`

### 顧客（CRM）
- `customers`: `idx_customers_tenant`
- `customers`: `idx_customers_phone`, `idx_customers_email`, `idx_customers_line`
- `customers`: `idx_customers_rfm`
- `customers`: `idx_customers_attributes` (GIN)
- `customers`: `idx_customers_tags` (GIN)
- `customers`: `idx_customers_name_search` (GIN + pg_trgm)

### 予約
- `reservations`: `idx_reservations_tenant`, `idx_reservations_date`
- `reservations`: `idx_reservations_customer`, `idx_reservations_practitioner`
- `reservations`: `idx_reservations_status`, `idx_reservations_period` (GiST)
- `reservations`: `idx_reservations_google_calendar`, `idx_reservations_salonboard`

### 予約明細
- `reservation_menus`: `idx_reservation_menus_reservation`, `idx_reservation_menus_tenant`
- `reservation_options`: `idx_reservation_options_reservation`, `idx_reservation_options_tenant`

### カルテ
- `kartes`: `idx_kartes_tenant`, `idx_kartes_customer`, `idx_kartes_reservation`
- `kartes`: `idx_kartes_date`, `idx_kartes_tags` (GIN)
- `karte_templates`: `idx_karte_templates_tenant`

### 管理者/設定/監査
- `admins`: `idx_admins_tenant`, `idx_admins_firebase`, `idx_admins_email_tenant`
- `settings`: `idx_settings_tenant`
- `daily_analytics`: `idx_daily_analytics_tenant_date`
- `audit_logs`: `idx_audit_logs_tenant`, `idx_audit_logs_entity`

---

## 二重予約防止（排他制約）

`reservations` テーブルには **GiST排他制約** があり、
同一テナント・同一スタッフの時間重複を防止する。

```sql
EXCLUDE USING GIST (
  tenant_id WITH =,
  practitioner_id WITH =,
  period WITH &&
) WHERE (status NOT IN ('canceled', 'no_show'))
```

---

## 推奨追加インデックス（マルチ店舗強化）

複数店舗を横断する運用が増えると、`store_id` を含む検索が増えるため、
以下の追加を推奨する。

```sql
CREATE INDEX idx_reservations_store_date ON reservations (tenant_id, store_id, date);
CREATE INDEX idx_reservations_store_status ON reservations (tenant_id, store_id, status, date);
CREATE INDEX idx_daily_analytics_store_date ON daily_analytics (tenant_id, store_id, date);
```

---

## インデックスの見直しサイクル

- 月次で **pg_stat_user_indexes** を確認
- 未使用インデックスは削除候補
- 大量書込みが発生するテーブルはインデックスを最小化
