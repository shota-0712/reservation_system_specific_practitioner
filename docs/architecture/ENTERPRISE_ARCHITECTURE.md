# GCPを活用した月間150万予約・1500店舗規模のマルチテナント型予約・CRMシステム

## アーキテクチャ設計およびコスト妥当性に関する包括的調査報告書

**バージョン**: 1.2.0
**最終更新日**: 2026-01-31
**ステータス**: Approved

---

## 1. エグゼクティブサマリー

本報告書は、月間150万件の予約処理と1,500店舗規模の顧客管理（CRM）を行うマルチテナント型SaaSプラットフォームの構築において、Google Cloud Platform（GCP）の主要サービスであるCloud Run、Cloud SQL、BigQuery、および必要に応じたキャッシュ層（Redis/Memorystore）を統合した最適なアーキテクチャを提案し、その技術的実現可能性、スケーラビリティ、およびコスト妥当性を詳細に検証したものである。

### 主要な結論

| 項目 | 結論 |
|------|------|
| **アーキテクチャ** | サーバーレス・コンテナファースト |
| **データ整合性** | PostgreSQL排他制約で二重予約を完全防止 |
| **マルチテナント分離** | Row Level Security (RLS) でDB層で強制 |
| **月額コスト** | 約$700-800（約10-12万円） |
| **予約あたりコスト** | 約$0.00053（約0.05円） |
| **店舗あたりコスト** | 約$0.53（約80円） |

---

## 2. アーキテクチャ設計思想とマルチテナント戦略

### 2.1 テナント分離モデルの比較と選定

| モデル | 概要 | 1500店舗規模における評価 | 判定 |
|--------|------|------------------------|------|
| **Silo** | 各テナントに独立したDBインスタンス | 不適合: 1,500個のCloud SQLインスタンス管理は非現実的 | × |
| **Bridge** | 1つのDBにテナントごとのスキーマ | 条件付き不適合: システムカタログ肥大化、マイグレーション複雑化 | △ |
| **Pool (RLS)** | 全テナントが同一テーブルを共有、tenant_idで論理分離 | **最適**: リソース効率最高、RLSでセキュリティ担保 | ◎ |

**採用モデル**: PostgreSQLの**行レベルセキュリティ（RLS）を用いたPoolモデル**

### 2.2 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────────┐
│                        クライアント層                                │
│   SPA (Next.js) / LIFF (LINE) / Mobile App                         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                    Cloud Load Balancing (SSL終端)
                                │
┌───────────────────────────────┼─────────────────────────────────────┐
│                        Cloud Run                                     │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│   │ 予約API      │  │ 管理画面API  │  │ バッチ処理   │              │
│   │ (Stateless)  │  │ (Stateless)  │  │ (Cloud Jobs) │              │
│   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
└──────────┼─────────────────┼─────────────────┼──────────────────────┘
           │                 │                 │
    ┌──────┴─────────────────┴─────────────────┴──────┐
    │                   PgBouncer                      │
    │              (Connection Pooling)                │
    └────────────────────────┬────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────────┐
│                     Cloud SQL (PostgreSQL)                           │
│   ┌────────────────────────────────────────────────────────────┐    │
│   │  Row Level Security (RLS) によるテナント分離                 │    │
│   │  排他制約 (Exclusion Constraints) による二重予約防止         │    │
│   │  JSONB + GINインデックスによるカスタムフィールド             │    │
│   └────────────────────────────────────────────────────────────┘    │
└────────────────────────────┬────────────────────────────────────────┘
                             │ Datastream (CDC)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          BigQuery                                    │
│   売上分析 / RFM分析 / 来訪予測 / CSVエクスポート                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                   キャッシュ/リアルタイム層（任意）                 │
│   Redis (Memorystore) / Pub/Sub                                      │
│   空き枠キャッシュ / セッション管理 / リアルタイム通知               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. データベース詳細設計：PostgreSQL

### 3.1 スキーマ設計と行レベルセキュリティ (RLS)

#### 予約テーブル定義

```sql
CREATE TABLE reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    store_id UUID,
    customer_id UUID NOT NULL,
    practitioner_id UUID NOT NULL,
    period TSTZRANGE NOT NULL,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('confirmed', 'canceled', 'pending', 'completed', 'no_show')),
    attributes JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    -- 排他制約（二重予約防止）
    EXCLUDE USING GIST (
        tenant_id WITH =,
        practitioner_id WITH =,
        period WITH &&
    ) WHERE (status NOT IN ('canceled', 'no_show'))
);

-- インデックス設計
CREATE INDEX idx_reservations_tenant ON reservations (tenant_id);
CREATE INDEX idx_reservations_date ON reservations (tenant_id, date);
CREATE INDEX idx_reservations_customer ON reservations (tenant_id, customer_id);
CREATE INDEX idx_reservations_practitioner ON reservations (tenant_id, practitioner_id, date);
```

#### RLSポリシー

```sql
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

-- 参照ポリシー
CREATE POLICY tenant_isolation_select ON reservations
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- 更新ポリシー
CREATE POLICY tenant_isolation_all ON reservations
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant')::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant')::UUID);
```

### 3.2 顧客テーブル（CRM）

```sql
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    
    -- 固定カラム（全店舗共通）
    name TEXT NOT NULL,
    name_kana TEXT,
    email TEXT,
    phone TEXT,
    line_user_id TEXT,
    
    -- 集計値（非正規化）
    total_visits INTEGER DEFAULT 0,
    total_spend DECIMAL(12, 2) DEFAULT 0,
    last_visit_at TIMESTAMPTZ,
    rfm_segment TEXT,
    
    -- カスタムフィールド（店舗固有）
    attributes JSONB DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- インデックス
CREATE INDEX idx_customers_tenant_phone ON customers (tenant_id, phone);
CREATE INDEX idx_customers_tenant_line ON customers (tenant_id, line_user_id);
CREATE INDEX idx_customers_attributes ON customers USING GIN (attributes);
CREATE INDEX idx_customers_tags ON customers USING GIN (tags);

-- RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers FOR ALL
    USING (tenant_id = current_setting('app.current_tenant')::UUID)
    WITH CHECK (tenant_id = current_setting('app.current_tenant')::UUID);
```

### 3.3 全テーブル一覧

| テーブル | 用途 | RLS |
|----------|------|-----|
| `tenants` | テナント（企業）マスタ | - |
| `tenant_google_calendar_oauth` | Google Calendar OAuth | - |
| `tenant_salonboard_config` | SalonBoard連携設定 | - |
| `stores` | 店舗マスタ | ✓ |
| `practitioners` | スタッフ | ✓ |
| `menus` | メニュー | ✓ |
| `menu_options` | メニューオプション | ✓ |
| `customers` | 顧客（CRM） | ✓ |
| `reservations` | 予約 | ✓ |
| `reservation_menus` | 予約-メニュー中間テーブル | ✓ |
| `reservation_options` | 予約-オプション中間テーブル | ✓ |
| `kartes` | カルテ | ✓ |
| `karte_templates` | カルテテンプレート | ✓ |
| `daily_analytics` | 日次集計 | ✓ |
| `settings` | 店舗設定 | ✓ |
| `admins` | 管理者 | ✓ |
| `audit_logs` | 監査ログ | - |

---

## 4. コンピューティング層：Cloud Run

### 4.1 サービス構成

| サービス | 役割 | スケール設定 |
|----------|------|-------------|
| `reservation-api` | 予約API | Min: 2, Max: 100 |
| `admin-api` | 管理画面API | Min: 1, Max: 50 |
| `batch-worker` | バッチ処理 | Min: 0, Max: 10 |

### 4.2 PgBouncerによる接続管理

```yaml
# Cloud Run サイドカー構成
containers:
  - name: app
    image: gcr.io/project/reservation-api
    ports:
      - containerPort: 8080
  - name: pgbouncer
    image: gcr.io/project/pgbouncer
    ports:
      - containerPort: 5432
```

---

## 5. 分析層：BigQuery

### 5.1 Datastreamによるリアルタイム同期

```
PostgreSQL (Cloud SQL)
    │
    │ WAL (Write Ahead Log)
    ▼
Datastream (CDC)
    │
    │ 準リアルタイム（数秒〜数分）
    ▼
BigQuery
    │
    ▼
Admin Dashboard / CSV Export
```

### 5.2 BigQueryテーブル設計

```sql
-- パーティショニング: 日付
-- クラスタリング: tenant_id
CREATE TABLE `project.analytics.reservations`
PARTITION BY DATE(created_at)
CLUSTER BY tenant_id
AS SELECT * FROM `project.raw.reservations`;
```

---

## 6. リアルタイム層：キャッシュ/リアルタイム（任意）

### 6.1 用途（限定的）

| 用途 | 推奨ストア |
|------|-----------|
| 空き枠キャッシュ | Redis |
| セッション管理 | Redis |
| LINE設定 | Cloud SQL（基本）/ Redis（キャッシュ） |
| リアルタイム通知 | Pub/Sub + Cloud Tasks |

---

## 7. コスト試算

### 7.1 前提条件

| 項目 | 値 |
|------|-----|
| 予約数 | 1,500,000件/月 |
| HTTPリクエスト数 | 30,000,000件/月 |
| データ量 | 500GB |
| リージョン | asia-northeast1 (東京) |

### 7.2 月額コスト内訳

| サービス | 構成 | 月額 |
|----------|------|------|
| **Cloud SQL** | 4vCPU, 16GB RAM, HA, 3年CUD | $315 |
| **Cloud Run** | リクエスト課金 + CPU/メモリ | $160 |
| **Redis (Memorystore)** | キャッシュ/リアルタイム用途 | $30 - $70 |
| **BigQuery + Datastream** | 10GB転送、クエリ | $70 |
| **その他** | LB, Storage, Network | $100 |
| **合計** | | **$695 - $800** |

### 7.3 ユニットエコノミクス

| 指標 | 値 |
|------|-----|
| 店舗あたりコスト | $0.53/月（約80円） |
| 予約あたりコスト | $0.00053（約0.05円） |
| SaaS月額料金想定 | ¥30,000〜¥100,000/店舗 |
| インフラ原価率 | **0.1%〜0.3%** |

---

## 8. 移行計画

### Phase 0: 準備（1週間）
- [ ] Cloud SQLインスタンス作成
- [ ] PostgreSQL スキーマ設計・作成
- [ ] RLS・排他制約の実装・テスト

### Phase 1: データ移行（必要な場合）
- [ ] 既存データストアから PostgreSQL への移行スクリプト
- [ ] データ検証・整合性チェック
- [ ] 並行運用テスト

### Phase 2: API改修（2週間）
- [ ] Repository層をPostgreSQL対応に書き換え
- [ ] PgBouncer接続設定
- [ ] RLSセッション設定ミドルウェア

### Phase 3: 分析基盤（1週間）
- [ ] Datastream設定
- [ ] BigQueryテーブル・ビュー作成
- [ ] Admin Dashboard のレポート機能接続

### Phase 4: 本番移行（1週間）
- [ ] Blue/Greenデプロイ
- [ ] モニタリング・アラート設定
- [ ] ロールバック手順確認

---

## 9. 結論

提案アーキテクチャ（Cloud Run + Cloud SQL with RLS + Cache層 + BigQuery）は、月間150万予約・1,500店舗という要件に対し、**技術的、運用的、財務的すべての側面において最適解**である。

特に：
1. **PostgreSQL排他制約**による二重予約の完全防止
2. **RLS**によるアプリケーション層に依存しないセキュアなマルチテナント分離
3. **予約あたり約0.05円**という極めて低いユニットコスト

これらは、ビジネスの高い競争力を約束するものである。
