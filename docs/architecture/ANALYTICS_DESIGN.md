# 分析・レポート設計書

**バージョン**: 2.1.0
**最終更新日**: 2026-01-31
**ステータス**: Active

---

## 1. 目的

- 店舗/テナントの売上・予約・顧客指標を可視化
- HQ（本社）が複数店舗を横断分析できること
- 管理画面にリアルタイム性とパフォーマンスを両立

---

## 2. データソース

| 種別 | データストア | 内容 |
|------|--------------|------|
| 予約 | Cloud SQL | `reservations` |
| 顧客 | Cloud SQL | `customers` |
| 日次集計 | Cloud SQL | `daily_analytics` |
| 拡張分析 | BigQuery（任意） | RFM/予測/BI |

---

## 3. 集計戦略

### 3.1 日次集計（基本）

- 夜間バッチで `daily_analytics` を更新
- ダッシュボードは **日次集計テーブルを参照**

### 3.2 リアルタイム補正（任意）

- 当日の予約・売上は `reservations` をリアルタイム集計
- 当日分のみ動的に補正

---

## 4. daily_analytics 設計

### 4.1 テーブル例

```sql
CREATE TABLE daily_analytics (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  store_id UUID,
  date DATE NOT NULL,
  total_revenue INTEGER DEFAULT 0,
  reservation_count INTEGER DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  canceled_count INTEGER DEFAULT 0,
  no_show_count INTEGER DEFAULT 0,
  new_customers INTEGER DEFAULT 0,
  returning_customers INTEGER DEFAULT 0,
  unique_customers INTEGER DEFAULT 0,
  average_order_value INTEGER DEFAULT 0,
  revenue_by_practitioner JSONB DEFAULT '{}',
  revenue_by_menu JSONB DEFAULT '{}',
  reservations_by_hour JSONB DEFAULT '{}',
  UNIQUE (tenant_id, store_id, date)
);
```

### 4.2 集計ロジック（概念）

- 売上 = `status = completed` の `total_price` 合計
- 新規顧客 = `first_visit_at = date`
- リピート = `total_visits > 1`

---

## 5. KPI一覧

| KPI | 定義 |
|-----|------|
| 予約数 | 指定期間内の予約件数 |
| 売上 | `completed` の合計売上 |
| 客単価 | 売上 / 予約数 |
| キャンセル率 | canceled / 予約数 |
| ノーショー率 | no_show / 予約数 |

---

## 6. HQダッシュボード（横断分析）

- テナント単位で全店舗を集計
- 店舗別ランキング、売上トレンド
- 期間比較（前週/前月/前年比）

---

## 7. BigQuery（任意）

大量データや高度分析は BigQuery を利用する。
Datastream / Cloud Functions で CDC 連携する。
