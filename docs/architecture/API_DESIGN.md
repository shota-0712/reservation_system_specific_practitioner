# API 設計書

**バージョン**: 2.1.0
**最終更新日**: 2026-01-31
**ステータス**: Active

## 関連ドキュメント

- [GLOSSARY.md](./GLOSSARY.md) - 用語定義
- [AUTH_DESIGN.md](./AUTH_DESIGN.md) - 認証設計
- [SECURITY_AND_URL_DESIGN.md](./SECURITY_AND_URL_DESIGN.md) - セキュリティ設計
- [ERROR_HANDLING_AND_LOGGING.md](./ERROR_HANDLING_AND_LOGGING.md) - エラーハンドリング
- [MONITORING_AND_ALERTING.md](./MONITORING_AND_ALERTING.md) - 監視とアラート

---

## 1. 概要

### 1.1 API 設計原則

- **RESTful**: リソース指向の設計
- **バージョニング**: URL パスにバージョンを含める（`/api/v1`）
- **テナント分離**: リクエストごとにテナントを解決し、DBはRLSで分離
- **一貫性**: 命名規則、レスポンス形式の統一
- **セキュリティ**: 認証・認可、Rate Limiting、CORS
- **冪等性**: 予約作成などはIdempotency-Keyを推奨

### 1.2 ベース URL

```
本番:    https://api.example.com/api/v1
開発:    http://localhost:8080/api/v1
```

### 1.3 テナント/店舗コンテキスト

```
/api/v1/{tenantKey}/...
```

- **tenantKey** は以下のいずれか
  - `tenant_id`（UUID）: 管理画面・内部用途
  - `tenant_slug`（文字列）: 管理画面URL
  - `store_code`（8〜10文字）: 顧客向けURL

**店舗指定**（複数店舗対応）:
- `tenantKey = store_code` の場合、`store_id` は自動解決される
- `tenantKey = tenant_id / tenant_slug` の場合は `X-Store-Id` または `?storeId=` を指定
- 予約作成時は **store_id が必須**（自動解決 or 明示指定）

### 1.4 共通ヘッダー

```http
Authorization: Bearer {firebase_id_token}
Content-Type: application/json
X-Request-ID: {uuid}        # トレース用
X-Store-Id: {store_id}      # 店舗コンテキスト（任意）
```

---

## 2. 認証・認可

### 2.1 管理者（Admin Web）

- **Firebase Auth** を使用
- APIには Firebase ID Token を送信

```http
Authorization: Bearer {firebase_id_token}
```

### 2.2 顧客（LINE ミニアプリ）

- LINE ID Token を `/auth/line` に送信
- サーバーが Firebase Custom Token を発行
- 以降の API 呼び出しは Firebase ID Token を使用

### 2.3 公開エンドポイント

以下は認証なしでアクセス可能（ただしRate Limit適用）:
- `GET /{tenantKey}/auth/config`
- `GET /{tenantKey}/menus`
- `GET /{tenantKey}/practitioners`
- `GET /{tenantKey}/slots`

---

## 3. レスポンス形式

### 3.1 成功時
```json
{
  "success": true,
  "data": { }
}
```

### 3.2 エラー時
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "入力内容に誤りがあります",
    "details": [
      { "field": "date", "message": "日付は必須です" }
    ]
  }
}
```

### 3.3 ページネーション
```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "hasMore": true
  }
}
```

---

## 4. 主なエンドポイント（v1）

### 4.1 認証
- `GET  /{tenantKey}/auth/config` - ミニアプリ初期化設定（公開）
- `POST /{tenantKey}/auth/line` - LINE認証（顧客）

### 4.2 メニュー/スタッフ
- `GET  /{tenantKey}/menus` - メニュー一覧（公開）
- `GET  /{tenantKey}/menus/:id` - メニュー詳細
- `POST /{tenantKey}/menus` - 作成（管理者）

- `GET  /{tenantKey}/practitioners` - スタッフ一覧（公開）
- `GET  /{tenantKey}/practitioners/:id` - スタッフ詳細
- `POST /{tenantKey}/practitioners` - 作成（管理者）

### 4.3 空き枠/予約
- `GET  /{tenantKey}/slots` - 空き枠取得
- `POST /{tenantKey}/reservations` - 予約作成（顧客）
- `GET  /{tenantKey}/reservations/my` - 自分の予約（顧客）
- `GET  /{tenantKey}/reservations` - 予約一覧（管理者）
- `PATCH /{tenantKey}/reservations/:id/status` - ステータス更新

### 4.4 管理画面
- `GET  /{tenantKey}/admin/dashboard/kpi`
- `GET  /{tenantKey}/admin/dashboard/today`
- `GET  /{tenantKey}/admin/customers`
- `GET  /{tenantKey}/admin/settings`
- `PUT  /{tenantKey}/admin/settings/profile`
- `GET  /{tenantKey}/admin/reports/summary`

---

## 5. 予約の競合防止（409）

PostgreSQL の排他制約により **二重予約** を防止。
予約作成時に `23P01` が返った場合は **409 Conflict** として扱う。

```json
{
  "success": false,
  "error": {
    "code": "RESERVATION_CONFLICT",
    "message": "この時間帯は既に予約が入っています"
  }
}
```

---

## 6. 冪等性（推奨）

予約作成には `Idempotency-Key` ヘッダーを推奨。
同じキーでの再送は同一結果を返す。

---

## 7. フィルタ・検索

例:
```
GET /{tenantKey}/reservations?date=2026-01-31&storeId=...&status=confirmed
GET /{tenantKey}/admin/customers?search=山田&tag=VIP
```

---

## 8. 実装メモ

- ルーティング実装は `backend-v2/src/routes/v1` に準拠
- テナント解決は `resolveTenant` ミドルウェアで実施
- DBアクセスは `set_tenant()` でRLSを有効化
