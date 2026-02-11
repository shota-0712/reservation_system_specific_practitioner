# PostgreSQL データベース

## 概要

このディレクトリには、マルチテナント予約・CRMシステムのPostgreSQLスキーマとマイグレーションファイルが含まれています。

## ディレクトリ構造

```
database/
├── README.md           # このファイル
├── schema/             # スキーマ定義
│   └── 001_initial_schema.sql
├── seeds/              # シードデータ
│   └── 001_dev_seed.sql
└── migrations/         # マイグレーション
```

## Cloud SQL インスタンス作成手順

### 1. GCPコンソールから作成

1. [Cloud SQL コンソール](https://console.cloud.google.com/sql) にアクセス
2. 「インスタンスを作成」をクリック
3. 「PostgreSQL」を選択
4. 以下の設定を行う：

| 項目 | 値 |
|------|-----|
| インスタンスID | `reservation-system-db` |
| パスワード | （自動生成を推奨） |
| リージョン | `asia-northeast1` (東京) |
| ゾーン | 複数ゾーン（高可用性） |
| データベースバージョン | PostgreSQL 15 |
| マシンタイプ | 4 vCPU, 16 GB RAM（Enterprise Plus） |
| ストレージ | SSD, 100GB（自動増加有効） |

### 2. gcloud CLI から作成

```bash
# インスタンス作成
gcloud sql instances create reservation-system-db \
  --database-version=POSTGRES_15 \
  --tier=db-custom-4-16384 \
  --region=asia-northeast1 \
  --availability-type=REGIONAL \
  --storage-type=SSD \
  --storage-size=100GB \
  --storage-auto-increase \
  --enable-point-in-time-recovery \
  --retained-backups-count=7 \
  --root-password=YOUR_ROOT_PASSWORD

# データベース作成
gcloud sql databases create reservation_system \
  --instance=reservation-system-db

# ユーザー作成
gcloud sql users create app_user \
  --instance=reservation-system-db \
  --password=YOUR_APP_USER_PASSWORD
```

## スキーマ適用

### Cloud SQL Auth Proxy を使用

```bash
# Auth Proxyのインストール（macOS）
brew install cloud-sql-proxy

# Auth Proxy起動
cloud-sql-proxy PROJECT_ID:asia-northeast1:reservation-system-db &

# スキーマ適用
psql -h 127.0.0.1 -U postgres -d reservation_system -f database/schema/001_initial_schema.sql

# シードデータ投入（開発環境のみ）
psql -h 127.0.0.1 -U postgres -d reservation_system -f database/seeds/001_dev_seed.sql
```

## 既存DBのアップグレード（v2.0 → v2.1）

すでに旧スキーマが適用済みの場合は、以下のマイグレーションを実行してください。

```bash
psql -h 127.0.0.1 -U postgres -d reservation_system -f database/migrations/20260131_schema_update_v2_1.sql
```

## RLS（Row Level Security）の使用方法

### アプリケーションからの接続時

```typescript
// 各リクエストの最初にテナントIDを設定
const pool = new Pool({...});

async function executeWithTenant<T>(
  tenantId: string,
  query: string,
  params: any[]
): Promise<T> {
  const client = await pool.connect();
  try {
    // トランザクション開始
    await client.query('BEGIN');
    
    // テナントID設定（ローカルスコープ）
    await client.query('SELECT set_tenant_local($1)', [tenantId]);
    
    // クエリ実行
    const result = await client.query(query, params);
    
    // コミット
    await client.query('COMMIT');
    
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

## 店舗コード（store_code）

顧客向けURLで使用する `store_code` は `stores` テーブルに保持します。
ユニーク制約で重複を防止し、推測困難なコードを採用します。

## 排他制約（二重予約防止）

`reservations` テーブルには以下の排他制約が設定されています：

```sql
EXCLUDE USING GIST (
    tenant_id WITH =,
    practitioner_id WITH =,
    period WITH &&
) WHERE (status NOT IN ('canceled', 'no_show'))
```

これにより、同じテナント・同じスタッフに対して、時間が重複する予約を作成しようとすると、自動的にエラーになります。

### 二重予約エラーのハンドリング

```typescript
try {
  await createReservation({ ... });
} catch (error) {
  if (error.code === '23P01') { // exclusion_violation
    throw new ConflictError('この時間帯は既に予約が入っています');
  }
  throw error;
}
```

## バックアップとリストア

### 自動バックアップ
Cloud SQLの自動バックアップが有効になっています（7日間保持）。

### 手動バックアップ

```bash
gcloud sql backups create --instance=reservation-system-db
```

### Point-in-Time Recovery

```bash
gcloud sql instances clone reservation-system-db restored-db \
  --point-in-time="2026-01-31T00:00:00Z"
```

## モニタリング

Cloud Monitoringで以下のメトリクスを監視：

- CPU使用率
- メモリ使用率
- 接続数
- レプリケーション遅延（HAの場合）
- クエリ実行時間

## トラブルシューティング

### 接続エラー

```bash
# 接続テスト
pg_isready -h 127.0.0.1 -p 5432
```

### RLSのデバッグ

```sql
-- 現在のテナントID確認
SELECT current_setting('app.current_tenant', true);

-- RLSポリシー確認
SELECT * FROM pg_policies WHERE tablename = 'reservations';
```
