# DB V3 / CRM 強化 引き継ぎ計画書（Phase-4 更新版）

更新日時: 2026-03-06 00:35 JST  
対象ブランチ: `main`（working tree）

## 0. この計画書の目的
- 次会話で迷わず再開できるよう、完了範囲・未完了範囲・判定状態を固定する。
- 本番切替（cutover）判断を `Go/No-Go` で即時参照できる状態を保つ。

## 1. 現在地（確定）

### 1.1 完了済み

- Wave-A:
  - `CRM-FE-001`（RFM API client）
  - `APP-001`（customer-app のモック/LIFF バイパス制御）
  - `CRM-FE-002`（RFM閾値 UI + GET/PUT + UIバリデーション）
  - `CRM-FE-003`（顧客セグメント新体系統一 + 旧値フォールバック）
  - `CRM-FE-004`（RFM再計算ジョブ UI）
  - `QA-001`（Wave-A 統合スモーク標準化）
- Wave-B:
  - `CRM-BE-006`（`tenant_notification_settings` migration + repository + type）
  - `CRM-BE-007`（`GET/PUT /api/v1/admin/settings/notifications` + unit test）
  - `CRM-FE-005`（settings 通知タブを API 永続化に接続）
  - `QA-002`（通知設定の回帰テスト手順/切り分けを runbook へ追加）
- Wave-C:
  - `OPS-002`（staging E2E のトークン運用 + preflight/postflight + 再実行条件を文書化）
  - `OPS-003`（cutover rehearsal 実施・実測記録・判定）

### 1.2 現在の判定

- **No-Go（2026-03-06 JST）**
- 理由:
  - `reserve-api` の 5xx 率が guardrails しきい値 `2.0%` を超過（実測 `2.33%` / 直近60分）
- 記録先:
  - `docs/runbooks/DB_V3_PHASE_B_EXECUTION_LOG.md` §10

## 2. 参照すべき正本

- 実行ログ（Phase B + QA + rehearsal）:
  - `docs/runbooks/DB_V3_PHASE_B_EXECUTION_LOG.md`
- ガードレール定義:
  - `docs/runbooks/DB_MIGRATION_GUARDRAILS.md`
- デプロイ/E2E運用:
  - `docs/DEPLOYMENT.md`
- 全体メモ:
  - `docs/PROJECT_MEMORY.md`

## 3. 次にやること（優先順）

1. `/api/v1/{tenant}/admin/dashboard/activity` の 5xx 原因を特定し修正する。
2. OPS-003 手順を再実施し、5xx 率 <= 2.0% を確認する。
3. 再実施結果で `Go/No-Go` を更新し、Go 条件充足時に cutover 実施枠を確定する。
4. cutover 後の運用監視（error率/p95/rollback readiness）を 24h 追跡する。

## 4. 再開時の固定実行順

1. `docs/runbooks/DB_V3_PHASE_B_EXECUTION_LOG.md` §10 を読み、No-Go根拠を確認
2. 5xx 対象エンドポイントの修正
3. `npm --prefix backend-v2 run lint && npm --prefix backend-v2 run typecheck && npm --prefix backend-v2 run test:ci -- tests/unit && npm --prefix backend-v2 run build`
4. `PROJECT_ID=keyexpress-reserve REGION=asia-northeast1 BACKEND_TRIGGER_NAME=reserve-backend API_SERVICE=reserve-api ./scripts/check_backend_deploy_iam.sh`
5. `PROJECT_ID=keyexpress-reserve CB_REGION=asia-northeast1 ./scripts/check_cloudbuild_triggers.sh`
6. rehearsal 再実施（preflight / health / rollback dry-run / Cloud Logging 実測）
7. runbook と `PROJECT_MEMORY` 更新

## 5. 次会話の開始プロンプト（コピペ用）

```text
`docs/runbooks/DB_V3_HANDOFF_PLAN.md` と `docs/runbooks/DB_V3_PHASE_B_EXECUTION_LOG.md` §10 を読んで、No-Go原因（/api/v1/{tenant}/admin/dashboard/activity の 5xx）を修正して。修正後に OPS-003 rehearsal を再実施し、5xx 率が 2.0% 以下なら Go 判定まで更新して。
```
