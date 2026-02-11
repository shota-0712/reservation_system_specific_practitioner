# 監査ログ設計書

**バージョン**: 2.1.0
**最終更新日**: 2026-01-31
**ステータス**: Active

---

## 1. 目的

- 誰が、いつ、何を、どのように変更したかを追跡
- セキュリティ・コンプライアンス要件を満たす
- 障害・不正操作の原因調査を迅速化

---

## 2. データストア

- **Primary**: Cloud SQL `audit_logs` テーブル
- **Option**: BigQuery にストリーミング（長期分析）

---

## 3. テーブル設計

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id),
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID,
  actor_type VARCHAR(20) NOT NULL, -- admin/customer/system
  actor_id UUID,
  actor_name VARCHAR(100),
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 4. 記録対象イベント

- 予約作成/更新/キャンセル
- 顧客情報更新
- スタッフ/メニューの作成・更新・削除
- 管理者権限変更
- テナント/店舗設定変更

---

## 5. 実装方針

1. APIレイヤーで **共通ミドルウェア** を用意
2. 重要操作時に差分を `old_values` / `new_values` に保存
3. `store_id` は `new_values` に必ず含め、店舗別フィルタを可能にする
4. 非同期処理でログ書き込み（失敗時は再試行）

---

## 6. 参照設計

- 管理画面から検索/フィルタ
- `tenant_id + created_at` で高速取得
