# Backend Development References

このディレクトリは、`backend-v2/` 実装時の参照文献をまとめたものです。  
アプリの仕様や運用の正本は `docs/architecture/` と `docs/runbooks/` を優先してください。

## 使い方（最短）

- APIを追加・変更する: `01` `02` `12`
- 認証・認可を触る: `03` `11` `12`
- 非同期処理やジョブを作る: `05` `06` `12`
- DBスキーマやマイグレーションを触る: `07` `08` `09` `10`
- パフォーマンス改善をする: `06` `08`

## 参照マップ

| Doc | Focus | 主な関連コード |
| --- | --- | --- |
| `00-introduction.md` | 全体像と学習順序 | `backend-v2/src/` 全体 |
| `01-rest-api-principles.md` | REST設計原則 | `backend-v2/src/routes/` |
| `02-endpoint-design.md` | エンドポイント設計 | `backend-v2/src/routes/v1/` |
| `03-authentication-authorization.md` | 認証/認可 | `backend-v2/src/middleware/`, `backend-v2/src/routes/` |
| `04-express-nestjs-mastery.md` | Express/Nest設計知識 | `backend-v2/src/` |
| `05-async-patterns.md` | 非同期・キュー・並列化 | `backend-v2/src/services/`, `backend-v2/src/jobs/` |
| `06-performance-optimization.md` | パフォーマンス最適化 | `backend-v2/src/services/`, `backend-v2/src/repositories/` |
| `07-schema-design.md` | スキーマ設計 | `database/schema/`, `database/migrations/` |
| `08-query-optimization.md` | クエリ最適化 | `backend-v2/src/repositories/` |
| `09-migration-management.md` | マイグレーション運用 | `database/migrations/`, `docs/runbooks/` |
| `10-schema-evolution.md` | スキーマ進化戦略 | `database/migrations/`, `docs/architecture/` |
| `11-backend-security.md` | バックエンドセキュリティ | `backend-v2/src/middleware/`, `docs/architecture/GCP_SECURITY_BASELINE.md` |
| `12-error-handling.md` | 例外設計と障害対応 | `backend-v2/src/middleware/`, `backend-v2/src/routes/` |
