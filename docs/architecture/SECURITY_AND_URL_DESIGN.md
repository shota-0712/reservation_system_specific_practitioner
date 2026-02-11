# セキュリティとURL設計

**バージョン**: 2.1.0
**最終更新日**: 2026-01-31
**ステータス**: Active

## 関連ドキュメント

- [GLOSSARY.md](./GLOSSARY.md) - 用語定義
- [MULTI_TENANT_ARCHITECTURE.md](./MULTI_TENANT_ARCHITECTURE.md) - アーキテクチャ
- [API_DESIGN.md](./API_DESIGN.md) - API設計
- [LINE_MINIAPP_DESIGN.md](./LINE_MINIAPP_DESIGN.md) - LINEミニアプリ設計
- [FIRESTORE_SECURITY_RULES.md](./FIRESTORE_SECURITY_RULES.md) - RLS/DBアクセス設計（旧名称）

---

## 1. 概要

マルチテナントSaaSでは、**URLの推測可能性**がセキュリティ上の弱点になる。
本書では、顧客向けURLに **推測困難な店舗コード** を採用し、
管理画面は認証前提で可読性を優先する設計を定義する。

---

## 2. 識別子設計

| 識別子 | 用途 | 例 | 公開範囲 |
|--------|------|----|----------|
| tenant_id | 内部ID | `UUID` | 非公開 |
| tenant_slug | 管理画面URL | `salon-group-a` | 半公開（認証必要） |
| store_id | 内部ID | `UUID` | 非公開 |
| store_code | 顧客向けURL | `a7x9m2k5` | 公開 |

**ポイント**:
- 顧客向けURLには `store_code` を使用
- 管理画面は `tenant_slug` を使用

---

## 3. URL構造

```
【顧客向け】店舗コード
https://reserve.example.com/{store_code}

【管理画面】テナントslug
https://admin.example.com/{tenant_slug}

【API】テナントキー
https://api.example.com/api/v1/{tenantKey}/...
- tenantKey = tenant_id / tenant_slug / store_code
```

**運用例**
- 顧客: `https://reserve.example.com/a7x9m2k5`
- 管理者: `https://admin.example.com/salon-group-a`
- API: `https://api.example.com/api/v1/a7x9m2k5/menus`

---

## 4. 店舗コード設計

### 4.1 推奨仕様
- **長さ**: 8〜10文字
- **文字種**: 小文字英数字（誤読防止なら `abcdefghjkmnpqrstuvwxyz23456789`）
- **唯一性**: DBでユニーク制約（全テナント横断で一意）

### 4.2 生成アルゴリズム例

```typescript
function generateReadableStoreCode(length = 8): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
```

### 4.3 重複チェック（PostgreSQL）

```sql
-- stores.store_code に UNIQUE 制約を設定
ALTER TABLE stores ADD CONSTRAINT uniq_stores_store_code UNIQUE (store_code);

-- 生成時に衝突したら再生成
SELECT 1 FROM stores WHERE store_code = $1 LIMIT 1;
```

---

## 5. セキュリティ対策

1. **推測困難性**: 36^8 以上の組み合わせ数
2. **レート制限**: 予約作成・認証は厳しめに制限
3. **公開/非公開分離**: PIIや予約履歴は必ず認証必須
4. **監査ログ**: `audit_logs` に書き込み

---

## 6. マルチ店舗対応の補足

`store_code` は `stores` テーブルに保持し、店舗単位で公開URLを分離する。
