# Backend V2 - TypeScript Reservation System API

## 概要

TypeScript + Express + PostgreSQL（Cloud SQL）ベースのマルチテナント対応予約システムバックエンド。

## 技術スタック

- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.7
- **Framework**: Express 5
- **Database**: PostgreSQL (Cloud SQL)
- **Authentication**: Firebase Auth + LINE Auth
- **Validation**: Zod

## ディレクトリ構造

```
backend-v2/
├── src/
│   ├── config/           # 設定ファイル
│   │   ├── env.ts        # 環境変数
│   │   └── firebase.ts   # Firebase初期化
│   ├── middleware/       # ミドルウェア
│   │   ├── auth.ts       # 認証
│   │   ├── tenant.ts     # テナント解決
│   │   ├── validation.ts # バリデーション
│   │   └── error-handler.ts
│   ├── repositories/     # データアクセス層（PostgreSQL）
│   │   ├── base.repository.ts
│   │   ├── tenant.repository.ts
│   │   ├── practitioner.repository.ts
│   │   ├── menu.repository.ts
│   │   ├── reservation.repository.ts
│   │   └── customer.repository.ts
│   ├── routes/           # APIルート
│   │   ├── v1/           # V1 API
│   │   └── system.routes.ts
│   ├── services/         # ビジネスロジック
│   ├── types/            # 型定義
│   │   └── index.ts
│   ├── utils/            # ユーティリティ
│   │   ├── errors.ts
│   │   └── logger.ts
│   └── index.ts          # エントリーポイント
├── package.json
├── tsconfig.json
├── Dockerfile
└── .env.example
```

## セットアップ

1. 依存関係のインストール:
```bash
npm install
```

2. 環境変数の設定:
```bash
cp .env.example .env
# .env を編集
```

3. 開発サーバー起動:
```bash
npm run dev
```

4. ビルド:
```bash
npm run build
```

## デプロイ（Cloud Run）

### 1) 手動デプロイ（ローカルから）

```bash
export PROJECT_ID=your-gcp-project
export REGION=asia-northeast1
export SERVICE_NAME=reservation-system-api
export IMAGE_NAME=reservation-system-api
export ENV_VARS="NODE_ENV=production,PORT=8080,DB_HOST=/cloudsql/PROJECT:REGION:INSTANCE,DB_USER=app_user,DB_NAME=reservation_system"
export SECRETS="DB_PASSWORD=DB_PASSWORD:latest,ENCRYPTION_KEY=ENCRYPTION_KEY:latest,FIREBASE_PRIVATE_KEY=FIREBASE_PRIVATE_KEY:latest,LINE_CHANNEL_SECRET=LINE_CHANNEL_SECRET:latest,LINE_CHANNEL_ACCESS_TOKEN=LINE_CHANNEL_ACCESS_TOKEN:latest"
export CLOUDSQL_CONNECTION="PROJECT:REGION:INSTANCE"

./scripts/deploy-cloud-run.sh
```

### 2) Cloud Build でデプロイ

```bash
gcloud builds submit \
  --config backend-v2/cloudbuild.yaml \
  --substitutions _SERVICE_NAME=reservation-system-api,_REGION=asia-northeast1,_IMAGE_NAME=reservation-system-api,_ENV_VARS="NODE_ENV=production,PORT=8080,DB_HOST=/cloudsql/PROJECT:REGION:INSTANCE,DB_USER=app_user,DB_NAME=reservation_system",_SECRETS="DB_PASSWORD=DB_PASSWORD:latest,ENCRYPTION_KEY=ENCRYPTION_KEY:latest,FIREBASE_PRIVATE_KEY=FIREBASE_PRIVATE_KEY:latest",_CLOUDSQL_CONNECTION="PROJECT:REGION:INSTANCE"
```

※ `ENV_VARS` / `SECRETS` / `CLOUDSQL_CONNECTION` はプロジェクトに合わせて調整してください。

## データベース接続

環境変数で接続先を指定します（例: Cloud SQL / ローカルPostgreSQL）。

```
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=app_user
DB_PASSWORD=*****
DB_NAME=reservation_system
```

開発用データは `database/seeds/001_dev_seed.sql` の投入を推奨します。
`backend-v2/scripts/seed.ts`/`seed.mjs` は Firestore 用の旧スクリプトのため利用しません。

## API エンドポイント

### システム
- `GET /health` - ヘルスチェック
- `GET /ready` - レディネスチェック
- `GET /info` - API情報

### メニュー (`/api/v1/:tenantId/menus`)
- `GET /` - メニュー一覧（公開）
- `GET /categories` - カテゴリ一覧
- `GET /:id` - メニュー詳細
- `POST /` - 作成（管理者）
- `PUT /:id` - 更新（管理者）
- `DELETE /:id` - 削除（管理者）

### 施術者 (`/api/v1/:tenantId/practitioners`)
- `GET /` - 施術者一覧（公開）
- `GET /by-menu/:menuId` - メニュー対応施術者
- `GET /:id` - 施術者詳細
- `POST /` - 作成（管理者）
- `PUT /:id` - 更新（管理者）
- `DELETE /:id` - 削除（管理者）

### 予約 (`/api/v1/:tenantId/reservations`)
- `POST /` - 予約作成（LINE認証）
- `GET /my` - 自分の予約（LINE認証）
- `DELETE /:id` - キャンセル（LINE認証）
- `GET /` - 予約一覧（管理者）
- `GET /today` - 今日の予約（管理者）
- `PUT /:id` - 予約変更（管理者）
- `PATCH /:id/status` - ステータス更新（管理者）

## 認証

### 管理者 (Firebase Auth)
```
Authorization: Bearer <Firebase ID Token>
```

### 顧客 (LINE Auth)
```
Authorization: Bearer <LINE ID Token>
```

## E2E テスト

Vitest で予約フローのスモークE2Eを実行できます。

```bash
npm run test:e2e
```

環境変数:

- `E2E_BASE_URL` (default: `http://localhost:8080`)
- `E2E_TENANT_KEY` (default: `d3m0s4ln`)
- `E2E_ADMIN_TOKEN` (管理者E2E。未設定なら該当テストはスキップ)
- `E2E_LINE_ID_TOKEN` (顧客E2E。未設定なら該当テストはスキップ)

## Firestore → PostgreSQL 移行

旧FirestoreからCloud SQL(PostgreSQL)へ移行するスクリプトを用意しています。

```bash
# Firestoreに接続できる認証（いずれか）
export FIREBASE_SERVICE_ACCOUNT=/path/to/service-account.json
# または gcloud auth application-default login

export DB_HOST=127.0.0.1
export DB_PORT=5432
export DB_USER=app_user
export DB_PASSWORD=your_password
export DB_NAME=reservation_system
export ENCRYPTION_KEY=your-32-byte-key

npm run migrate:firestore
```

オプション環境変数:

- `MIGRATE_DRY_RUN=true`：DBへの書き込みをせずに検証
- `MIGRATE_TENANT_IDS=tenantId1,tenantId2`：対象テナント限定
- `MIGRATE_TENANT_ID=tenantId`：tenantsコレクションがない場合の単体移行
- `MIGRATE_PRESERVE_RAW=true`：元データを `attributes` に保存

## マルチテナント

テナントID/店舗コードは以下の方法で解決:
1. URLパラメータ: `/api/v1/:tenantKey/...` （tenant_id または store_code）
2. ヘッダー: `X-Tenant-Id: tenant-id`
3. サブドメイン: `tenant-id.example.com`

DB側では RLS（Row Level Security）により tenant_id を強制します。

## エラーレスポンス

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "入力データが無効です",
    "details": {
      "validationErrors": {
        "name": ["名前は必須です"]
      }
    }
  }
}
```

## ライセンス

ISC
