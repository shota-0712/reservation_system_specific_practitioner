# データアクセス制御設計（RLS / アプリ認可）

**バージョン**: 2.1.0
**最終更新日**: 2026-01-31
**ステータス**: Active

> ※ファイル名は旧称（Firestore Security Rules）ですが、
> 現行設計は **PostgreSQL + RLS** を前提としています。

## 目的

マルチテナント環境における **データ分離・権限管理** を体系化する。
- DB層: RLS によるテナント分離
- アプリ層: 管理者ロール/店舗権限の制御

## 関連ドキュメント

- [MULTI_TENANT_ARCHITECTURE.md](./MULTI_TENANT_ARCHITECTURE.md)
- [AUTH_DESIGN.md](./AUTH_DESIGN.md)
- [SECURITY_AND_URL_DESIGN.md](./SECURITY_AND_URL_DESIGN.md)

---

## 1. 基本方針

1. **RLSでテナント分離を強制**（全テーブルにtenant_id）
2. **アプリ層でロール判定**（owner/admin/manager/staff）
3. **店舗単位の制限**（admin.store_ids を使用）
4. **最小権限の原則**（公開エンドポイント以外は認証必須）

---

## 2. RLS（Row Level Security）設計

### 2.1 テナントコンテキスト

各リクエスト開始時に `set_tenant()` を実行し、
`app.current_tenant` にテナントIDをセットする。

`tenant_id` は `tenantKey`（tenant_id / tenant_slug / store_code）から解決する。

```sql
CREATE OR REPLACE FUNCTION set_tenant(tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_tenant', tenant_id::text, false);
END;
$$ LANGUAGE plpgsql;
```

### 2.2 RLSポリシー例

```sql
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON reservations
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant', true)::UUID)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::UUID);
```

---

## 3. アプリケーション認可

### 3.1 管理者ロール

`admins.role` により権限を管理する。

- owner: 全権限
- admin: ほぼ全権限
- manager: 店舗管理・分析
- staff: 予約/顧客の参照・更新

### 3.2 店舗スコープ

`admins.store_ids` が空の場合は全店舗アクセス可。
空でない場合は **指定店舗のみ** を操作可能。

**実装方針**:
- APIで `store_id` が指定されているか検証
- `store_id` が `admin.store_ids` に含まれているかを確認

---

## 4. 公開エンドポイントの扱い

- `/auth/config`, `/menus`, `/practitioners`, `/slots` は公開
- ただし **Rate Limit** と **IP監視** を必須
- PII を含むAPIは認証必須

---

## 5. バッチ/システム処理

- 定期ジョブ（リマインド送信、集計）は **専用サービスアカウント** を使用
- RLSを無効化する場合は **専用DBロール** を利用
- 監査ログに必ず記録

---

## 6. 監査ログ

`audit_logs` に以下を記録する。
- 誰が、いつ、どのエンティティを更新したか
- IP / User-Agent / 変更前後の差分
