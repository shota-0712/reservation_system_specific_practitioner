# エラーハンドリング & ロギング設計

**バージョン**: 2.1.0
**最終更新日**: 2026-01-31
**ステータス**: Active

---

## 1. 目的

- APIのエラー応答を統一
- DB制約違反やRLSエラーを適切に変換
- 監視と分析が可能なログ構造を定義

---

## 2. エラーレスポンス形式

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "入力内容に誤りがあります"
  }
}
```

---

## 3. 代表的なエラーコード

| code | HTTP | 内容 |
|------|------|------|
| VALIDATION_ERROR | 400 | バリデーションエラー |
| AUTHENTICATION_ERROR | 401 | 認証失敗 |
| AUTHORIZATION_ERROR | 403 | 権限不足 |
| NOT_FOUND | 404 | 対象が存在しない |
| RESERVATION_CONFLICT | 409 | 二重予約（排他制約） |
| RATE_LIMITED | 429 | レート制限 |
| INTERNAL_ERROR | 500 | 想定外エラー |

---

## 4. PostgreSQLエラーの変換

| SQLSTATE | 意味 | 変換例 |
|----------|------|--------|
| 23505 | unique_violation | 409 CONFLICT |
| 23P01 | exclusion_violation | 409 RESERVATION_CONFLICT |
| 23503 | foreign_key_violation | 400 INVALID_REFERENCE |
| 42501 | insufficient_privilege | 403 AUTHORIZATION_ERROR |

---

## 5. ログ設計

- **構造化ログ（JSON）**
- `request_id`, `tenant_id`, `store_id` を必ず含める
- エラーは `error_code`, `stack`, `sqlstate` を記録

---

## 6. 監査ログ

重要操作は `audit_logs` に記録する。
（詳細は [AUDIT_LOG_DESIGN.md](./AUDIT_LOG_DESIGN.md)）
