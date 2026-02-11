# 認証・認可設計書

**バージョン**: 2.1.0
**最終更新日**: 2026-01-31
**ステータス**: Active

---

## 1. 概要

### 1.1 認証方式

| ユーザー種別 | 認証方式 | 認可データの格納 |
|-------------|----------|------------------|
| 顧客（LINEミニアプリ） | LINE ID Token → Firebase Custom Token | `customers` テーブル |
| 管理者（Admin Web） | Firebase Auth (Email/Password) | `admins` テーブル |
| プラットフォーム管理 | Firebase Auth + 特別ロール | `admins` / `tenants` |

### 1.2 認証フロー概要

```
顧客 (LINE)                        管理者 (Web)
┌────────────┐                   ┌─────────────┐
│ LINE App   │                   │ Admin Web   │
└─────┬──────┘                   └─────┬───────┘
      │ LINE ID Token                     │ Firebase Auth
      ▼                                   ▼
┌────────────┐                   ┌────────────────┐
│ API Server │                   │ API Server     │
│ /auth/line │                   │ Authorization  │
└─────┬──────┘                   └─────┬──────────┘
      │ verify + user upsert              │ admins 参照
      ▼                                   ▼
┌────────────┐                   ┌────────────────┐
│ Firebase   │                   │ PostgreSQL     │
│ CustomToken│                   │ admins table   │
└────────────┘                   └────────────────┘
```

---

## 2. 顧客認証（LINEミニアプリ）

### 2.1 フロー

1. LINEミニアプリ起動（URLの `store_code` から `tenantKey` を解決）
2. `GET /{tenantKey}/auth/config` で LIFF/ブランド設定取得
3. LINE SDKで ID Token を取得
4. `POST /{tenantKey}/auth/line` に送信
5. APIが LINE ID Token を検証
6. `customers` に **upsert**（LINEユーザーIDで照合）
7. Firebase Custom Token を発行
8. 以降の API 呼び出しは Firebase ID Token を使用

### 2.2 顧客Upsertの設計

- キー: `line_user_id`
- 更新: display_name / picture_url / notification_token
- 予約のたびに最新情報を反映

---

## 3. 管理者認証（Admin Web）

### 3.1 フロー

1. 管理画面で Firebase Auth にログイン
2. API が ID Token を検証
3. `admins` テーブルで該当ユーザーを取得
4. `role` と `store_ids` で権限判定

### 3.2 管理者権限

| role | 権限範囲 |
|------|----------|
| owner | 全権限 |
| admin | ほぼ全権限 |
| manager | 店舗/分析/設定 |
| staff | 予約・顧客参照/更新 |

**店舗スコープ**
- `admins.store_ids` が空の場合は全店舗
- 指定がある場合はその店舗のみアクセス可能

---

## 4. 認可ミドルウェア設計

- `requireFirebaseAuth()` → Firebase ID Token 検証
- `requireLineAuth()` → LINE顧客用のユーザー認証
- `requirePermission()` → role/permissions/store_ids をチェック

---

## 5. セキュリティ方針

- **最小権限**: 管理者/スタッフの操作範囲を厳格化
- **RLSとの併用**: DB層でも tenant_id を強制
- **監査ログ**: 権限操作・重要更新は `audit_logs` に記録
