# DB V3 再設計 引き継ぎ計画書（Phase A/B 完了版）

更新日時: 2026-03-05 06:50 JST  
対象ブランチ: `main`（HEAD: `769c6e2`）

## 0. この計画書の目的
- 長い会話コンテキストを切っても、次会話で同じ地点から再開できるようにする。
- 「何を実装したか」「何が完了したか」「次に何をやるか」を固定する。

## 1. いまの到達点（サマリ）

- Phase A（migration SQL vs API 差分監査）: **完了**
  - must-fix 2件を修正済み
- Phase B（staging migration + exports E2E）: **完了**
  - migration 適用と `schema_migrations` の version/checksum/applied_at を確認済み
  - `POST /api/v1/admin/exports` -> `GET status` -> `GET download` まで通過
- ドキュメント（ER図/スキーマ定義）: **作成済み**
- 残課題: `claims/sync` が RLS 影響で 500（既存管理者の claim 再同期に影響）

## 2. 実装・修正済み

### 2.1 must-fix 修正（Phase A）

1. 予約時間正本化の API 側不整合を修正
- ファイル:
  - `backend-v2/src/repositories/reservation.repository.ts`
- 内容:
  - `create`/`update`/`updateWithItems` で `starts_at/ends_at` を明示更新
  - 競合判定を `tstzrange(starts_at, ends_at, '[)')` ベースに揃えた

2. onboarding/register の RLS 500 を修正
- ファイル:
  - `backend-v2/src/services/onboarding.service.ts`
  - `backend-v2/tests/unit/onboarding.service.test.ts`
- 内容:
  - `admins` の事前 SELECT を除去
  - `admins.firebase_uid` の UNIQUE 制約違反（`23505`）で競合扱い
  - 単体テストを現行実装に追従

### 2.2 Phase B 実行結果

- migration 適用済み（確認済みファイル）:
  - `20260305_add_rls_to_tenants_audit_logs.sql`
  - `20260305_customers_line_unique_constraint.sql`
  - `20260305_fix_set_tenant_scope.sql`
  - `20260306_v3_core_normalization_and_exports.sql`
  - `20260307_export_jobs_gcs_storage.sql`
- exports E2E:
  - `POST /api/v1/admin/exports` = `202`（`Location` ヘッダー確認済み）
  - `GET /api/v1/admin/exports/:id` = `completed`
  - `GET /api/v1/admin/exports/:id/download` = `200`

### 2.3 デプロイ状況

- Cloud Build の `backend-deploy` は `iam.serviceaccounts.actAs` で失敗するケースあり
- 手動 `gcloud run deploy` で回避し、最新 revision 反映済み
  - `reserve-api-00035-l2w`

## 3. 成果物（参照ファイル）

- 引き継ぎ計画書（このファイル）:
  - `docs/runbooks/DB_V3_HANDOFF_PLAN.md`
- Phase A 監査:
  - `docs/runbooks/DB_V3_PHASE_A_AUDIT.md`
- Phase B 実行ログ:
  - `docs/runbooks/DB_V3_PHASE_B_EXECUTION_LOG.md`
- ER図:
  - `docs/architecture/DB_V3_ERD.md`
- スキーマ定義:
  - `docs/architecture/DB_V3_SCHEMA_DEFINITION.md`
- ガードレール:
  - `docs/runbooks/DB_MIGRATION_GUARDRAILS.md`

## 4. 未完了タスク（次会話の実行対象）

### 4.1 P0: `claims/sync` の 500 解消（must-fix）

現象:
- `POST /api/platform/v1/admin/claims/sync` が 500
- ログ: `invalid input syntax for type uuid: ""`

原因:
- tenant context 未設定で `admins` を参照し、RLS policy の
  `current_setting('app.current_tenant', true)::uuid` キャストで失敗

完了条件:
- `claims/sync` が 200 で `tenantId` を返す
- tenant claim 未付与の既存管理者で token refresh 後に `/api/v1/admin/*` 到達可能
- 単体/統合テストを追加または更新

### 4.2 P1: デプロイパイプライン復旧（運用課題）

現象:
- Cloud Build の `backend-deploy` が `iam.serviceaccounts.actAs` で失敗

完了条件:
- `gcloud builds submit --config cloudbuild.yaml ...` で backend deploy ステップが成功
- 手動 deploy なしで最新 revision 反映

### 4.3 P2: 本番切替リハーサル（Phase C）

実施内容:
- `docs/runbooks/DB_MIGRATION_GUARDRAILS.md` 準拠のリハーサル
- ベースライン（p95 / error rate）取得
- Go/No-Go 判定記録

完了条件:
- リハーサル報告（所要時間・閾値判定・切戻し可否）を文書化

## 5. 次会話での実行順（固定）

1. `claims/sync` 500 の再現（curl + Cloud Run logs）
2. `backend-v2/src/routes/platform/onboarding.routes.ts` の修正
3. テスト追加・更新（最低 `onboarding/claims sync` 経路）
4. backend build/deploy
5. `claims/sync` スモーク + token refresh + `/api/v1/admin/exports` 再確認
6. 実行ログを `docs/runbooks/DB_V3_PHASE_B_EXECUTION_LOG.md` に追記
7. 余力があれば Cloud Build deploy 権限課題に着手

## 6. 受け入れ基準（次ゴール）

- `claims/sync` 500 が解消される
- 既存管理者（claim 未付与想定）でも admin API 利用が復旧する
- exports E2E が継続して成功する
- 実行ログ/監査ドキュメントが更新される

## 7. 次会話の開始プロンプト（コピペ用）

```text
`docs/runbooks/DB_V3_HANDOFF_PLAN.md` を読んで、P0（claims/sync 500 解消）から実装して。再現 -> 修正 -> テスト -> デプロイ -> スモークまで一気通しで進めて、結果を `docs/runbooks/DB_V3_PHASE_B_EXECUTION_LOG.md` に追記して。
```
