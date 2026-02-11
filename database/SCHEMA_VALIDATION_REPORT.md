# データ構造検証レポート

**作成日**: 2026-01-31
**バージョン**: 2.1.0
**ステータス**: 承認待ち

---

## 1. 検証プロセス

既存のアプリケーションとドキュメントを精査し、PostgreSQLスキーマを改訂しました。

### 1.1 検証対象

| 対象 | ファイル | 確認内容 |
|------|----------|----------|
| Customer App | `customer-app/index.html` | 予約フロー、メニュー選択、施術者選択、顧客情報入力 |
| Admin Dashboard | `admin-dashboard/src/lib/*.ts` | API構造、データモデル、モックデータ |
| 設計ドキュメント | `docs/architecture/*.md` | 全23ドキュメント |

### 1.2 主な発見と対応

| 発見事項 | 元スキーマ | 改訂版 |
|---------|-----------|--------|
| カルテ機能 | ❌ 未対応 | ✅ `kartes`, `karte_templates` テーブル追加 |
| Google Calendar OAuth | ❌ 未対応 | ✅ `tenant_google_calendar_oauth` テーブル追加 |
| サロンボード連携 | ❌ 未対応 | ✅ `tenant_salonboard_config` テーブル追加 |
| 顧客プロファイル拡張 | △ 不十分 | ✅ `birthday`, `hair_type`, `allergies` 等追加 |
| 複数メニュー対応 | △ 不十分 | ✅ `reservation_menus.is_main`, `sort_order` 追加 |
| 施術者PR情報 | ❌ 未対応 | ✅ `practitioners.pr_title`, `specialties` 追加 |
| 外部連携ID | ❌ 未対応 | ✅ `google_calendar_event_id`, `salonboard_reservation_id` 追加 |
| 店舗コードの分離 | ❌ テナントに混在 | ✅ `stores.store_code` に移管 |

---

## 2. 改訂版スキーマ概要

### 2.1 テーブル一覧（17テーブル）

| # | テーブル名 | 説明 | RLS | 新規 |
|---|-----------|------|-----|------|
| 1 | `tenants` | テナント（企業） | - | - |
| 2 | `tenant_google_calendar_oauth` | Google Calendar OAuth設定 | - | ✅ |
| 3 | `tenant_salonboard_config` | サロンボード連携設定 | - | ✅ |
| 4 | `stores` | 店舗 | ✅ | - |
| 5 | `practitioners` | 施術者 | ✅ | - |
| 6 | `menus` | メニュー | ✅ | - |
| 7 | `menu_options` | オプション | ✅ | - |
| 8 | `customers` | 顧客（CRM） | ✅ | - |
| 9 | `reservations` | 予約 | ✅ | - |
| 10 | `reservation_menus` | 予約-メニュー中間 | ✅ | - |
| 11 | `reservation_options` | 予約-オプション中間 | ✅ | - |
| 12 | `kartes` | カルテ（施術記録） | ✅ | ✅ |
| 13 | `karte_templates` | カルテテンプレート | ✅ | ✅ |
| 14 | `admins` | 管理者 | ✅ | - |
| 15 | `daily_analytics` | 日次集計 | ✅ | - |
| 16 | `settings` | 設定 | ✅ | - |
| 17 | `audit_logs` | 監査ログ | - | - |

### 2.2 主要な制約・機能

| 機能 | 実装 |
|------|------|
| 行レベルセキュリティ (RLS) | 13テーブルに適用 |
| 排他制約（二重予約防止） | `reservations.period` に GIST 排他制約 |
| 全文検索 | `customers.name` に pg_trgm インデックス |
| JSONB インデックス | `customers.attributes`, `customers.tags` |
| 自動タイムスタンプ | 全テーブルに `updated_at` トリガー |

---

## 3. Firestore との対応

### 3.1 コレクションマッピング

| Firestore パス | PostgreSQL テーブル |
|----------------|---------------------|
| `/tenants/{tenantId}` | `tenants` |
| `/tenants/{tenantId}/stores/{storeId}` | `stores` |
| `/tenants/{tenantId}/stores/{storeId}/practitioners` | `practitioners` |
| `/tenants/{tenantId}/stores/{storeId}/menus` | `menus` |
| `/tenants/{tenantId}/stores/{storeId}/options` | `menu_options` |
| `/tenants/{tenantId}/users/{userId}` | `customers` |
| `/tenants/{tenantId}/reservations` | `reservations` |
| `/tenants/{tenantId}/users/{userId}/kartes/{karteId}` | `kartes` |
| `/tenants/{tenantId}/karteTemplates/{templateId}` | `karte_templates` |
| `/tenants/{tenantId}/admins/{adminId}` | `admins` |
| `/tenants/{tenantId}/googleCalendar/oauth` | `tenant_google_calendar_oauth` |

### 3.2 データ型マッピング

| Firestore | PostgreSQL |
|-----------|------------|
| `string` | `VARCHAR` or `TEXT` |
| `number` | `INTEGER` or `DECIMAL` |
| `boolean` | `BOOLEAN` |
| `timestamp` | `TIMESTAMPTZ` |
| `array` | `TYPE[]` (PostgreSQL配列) |
| `map/object` | `JSONB` |
| Document Reference | `UUID` (外部キー) |

---

## 4. Customer App との整合性

### 4.1 予約フロー

```
Customer App Flow              PostgreSQL Tables
================              =================
Step 1: メニュー選択          → menus
Step 2: 追加メニュー          → reservation_menus (is_main=false)
Step 3: 施術者選択            → practitioners
Step 4: 日時選択              → reservations.period
Step 5: 顧客情報入力          → customers (name, phone, email)
Step 6: 確認・予約確定        → reservations (status='confirmed')
```

### 4.2 施術者表示情報

Customer Appで表示される施術者情報との対応：

| Customer App | PostgreSQL `practitioners` |
|--------------|----------------------------|
| `name` | `name` |
| `title` | `title` |
| `imageUrl` | `image_url` |
| `nominationFee` | `nomination_fee` |
| `experience` | `experience` |
| `prTitle` | `pr_title` ✅ 新規追加 |
| `description` | `description` |
| `specialties` | `specialties` ✅ 新規追加 |
| `sns` | `sns_instagram`, `sns_twitter` |

---

## 5. Admin Dashboard との整合性

### 5.1 API エンドポイント対応

| API | PostgreSQL |
|-----|------------|
| `GET /reservations` | `SELECT * FROM reservations` |
| `GET /customers` | `SELECT * FROM customers` |
| `GET /practitioners` | `SELECT * FROM practitioners` |
| `GET /menus` | `SELECT * FROM menus` |
| `GET /admin/dashboard/kpi` | `SELECT * FROM daily_analytics` |
| `GET /admin/reports/*` | `daily_analytics` + 集計クエリ |

### 5.2 KPI 計算

```sql
-- 本日のKPI例
SELECT 
    COUNT(*) as today_reservations,
    SUM(total_price) as today_revenue,
    COUNT(DISTINCT customer_id) as unique_customers
FROM reservations
WHERE tenant_id = $1 
  AND date = CURRENT_DATE
  AND status IN ('confirmed', 'completed');
```

---

## 6. ドキュメントとの整合性

### 6.1 KARTE_DESIGN.md

| 設計書の項目 | PostgreSQL |
|-------------|------------|
| `karteId` | `kartes.id` |
| `userId` | `kartes.customer_id` |
| `reservationId` | `kartes.reservation_id` |
| `details.treatment.description` | `kartes.treatment_description` |
| `details.treatment.colorFormula` | `kartes.color_formula` |
| `photos.before[]` | `kartes.photos_before` (TEXT[]) |
| `photos.after[]` | `kartes.photos_after` (TEXT[]) |
| `customFields` | `kartes.custom_fields` (JSONB) |

### 6.2 GOOGLE_CALENDAR_INTEGRATION.md

| 設計書の項目 | PostgreSQL |
|-------------|------------|
| OAuth refresh_token | `tenant_google_calendar_oauth.refresh_token_encrypted` |
| scope | `tenant_google_calendar_oauth.scope` |
| email | `tenant_google_calendar_oauth.email` |
| channel_ids | `tenant_google_calendar_oauth.channel_ids` |
| Calendar Event ID | `reservations.google_calendar_event_id` |

### 6.3 SALONBOARD_SYNC_FINAL.md

| 設計書の項目 | PostgreSQL |
|-------------|------------|
| 認証情報 | `tenant_salonboard_config.*_encrypted` |
| 同期状態 | `tenant_salonboard_config.last_sync_*` |
| サロンボード予約ID | `reservations.salonboard_reservation_id` |
| スタッフID | `practitioners.salonboard_staff_id` |

---

## 7. 推奨事項

### 7.1 追加検討事項

| 項目 | 状態 | 備考 |
|------|------|------|
| Web Push通知 (`WEB_PUSH_DESIGN.md`) | 対応予定 | `web_push_subscriptions` テーブル案を追加 |
| ホットペッパー連携 | 未対応 | サロンボード経由のため不要か |
| 請求・決済履歴 | 未対応 | Stripe側で管理 |

### 7.2 移行優先順位

1. **Phase 0**: Cloud SQL インスタンス作成
2. **Phase 1**: スキーマ適用（`001_initial_schema.sql`）
3. **Phase 2**: マイグレーションヘルパー適用（`002_migration_from_firestore.sql`）
4. **Phase 3**: データ移行（Node.js スクリプト）
5. **Phase 4**: Backend API 書き換え
6. **Phase 5**: 並行稼働・検証
7. **Phase 6**: Firestore 廃止

---

## 8. 次のステップ

- [ ] このレポートを確認・承認
- [ ] Cloud SQL インスタンスを作成
- [ ] スキーマを適用
- [ ] マイグレーションスクリプトを作成

**質問があれば、いつでもお知らせください！**
