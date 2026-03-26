# カルテ機能設計書

**バージョン**: 2.2.0
**最終更新日**: 2026-03-22
**ステータス**: Active

---

## 1. 目的

- 施術履歴を蓄積し、顧客満足度と再来店率を向上
- スタッフ間の引継ぎを容易にする
- 現行スライスでは `customerId` / `reservationId` の検索フィルタは提供しない。取得は一覧・詳細のみ。

---

## 2. データモデル

### 2.1 `kartes` テーブル

- `customer_id`, `practitioner_id`, `store_id`, `reservation_id` に紐付け
- `visit_date` は API 層で `YYYY-MM-DD`、DB は `DATE`
- 写真は Cloud Storage に保存し URL を保持
- `tenant_id` を RLS で強制

### 2.2 `karte_templates` テーブル

- 店舗ごとにカルテ入力項目をカスタマイズ
- JSONB で動的項目を保持
- テンプレート一覧は active / inactive を含む tenant 正本

---

## 3. 主要機能

- カルテ作成/更新/閲覧/削除
- カルテテンプレート CRUD
- 予約詳細からカルテへ遷移
- 顧客詳細から過去カルテ一覧
- 作成/更新/削除時は audit log を記録する

---

## 4. アクセス制御

- Admin API は Firebase auth + `canManageCustomers` を要求する
- `owner` は permission check をバイパスする
- RLS で `tenant_id` を強制し、`kartes` / `karte_templates` は tenant isolation を維持する

---

## 5. 現行 API

- `GET /api/v1/admin/kartes?limit=...`
- `GET /api/v1/admin/kartes/:id`
- `POST /api/v1/admin/kartes`
- `PUT /api/v1/admin/kartes/:id`
- `DELETE /api/v1/admin/kartes/:id`
- `GET /api/v1/admin/karte-templates`
- `GET /api/v1/admin/karte-templates/:id`
- `POST /api/v1/admin/karte-templates`
- `PUT /api/v1/admin/karte-templates/:id`
- `DELETE /api/v1/admin/karte-templates/:id`
