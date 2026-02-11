# バックエンド実装計画書

**作成日**: 2026-01-31
**ステータス**: Active
**目的**: Cloud SQL (PostgreSQL) + RLS ベースのマルチテナントAPIへ整備

---

## 1. 現状

- 旧版は Google Sheets / 単一テナント
- 新バックエンド（v2）は TypeScript + Express を導入済み
- **Cloud SQL + RLS** への移行は進行中
  - テナント解決（tenant_id / tenant_slug / store_code）は SQL で対応済み
  - Menu / Practitioner Repository は SQL 化済み
  - 予約/顧客/設定/レポート系は引き続き移行が必要

---

## 2. 目標アーキテクチャ

```
Client (LINE / Admin) → API (Cloud Run) → Cloud SQL (PostgreSQL)
                                            ├ RLS (tenant_id)
                                            └ 排他制約 (予約重複防止)
```

---

## 3. 実装フェーズ

### Phase 0: 基盤整備
- DatabaseService（pg）導入
- RLSセッション設定（set_tenant）
- エラーハンドリング統一

### Phase 1: Repository移行
- Reservation / Customer / Settings をSQL化
- 既存の Menu / Practitioner を含め、全Repositoryを SQLに統一

### Phase 2: Admin API
- 予約/顧客/設定 API のSQL対応
- store_id フィルタ対応（HQは未指定で横断）

### Phase 3: バッチ・通知
- リマインド・分析バッチ
- audit_logs への記録

---

## 4. 成功条件

- 二重予約 0%（排他制約）
- テナント越境 0件（RLS）
- p95 レイテンシ < 1s
