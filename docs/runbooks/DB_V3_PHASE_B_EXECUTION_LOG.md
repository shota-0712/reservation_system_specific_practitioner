# DB V3 Phase B 実行ログ（staging migration + exports smoke）

更新日時: 2026-03-05 JST

## 1. 実行対象

- Phase B-1: staging DB へ migration 適用
- Phase B-2: `schema_migrations` 記録と checksum 一致確認
- Phase B-3: 管理API exports E2E（作成 / 状態取得 / ダウンロード）

## 2. 実行結果サマリ

- Phase B-1: **完了**
- Phase B-2: **完了**（version/checksum/applied_at を確認）
- Phase B-3: **完了**（`POST 202 + Location` / `GET completed` / `download 200`）

補足（残課題）:

- `/api/platform/v1/admin/claims/sync` は現行 revision で RLS 影響により 500（詳細は §5）
- ただし新規登録フロー (`onboarding/register` が claims を直接付与) + token refresh 経路では exports E2E は成立
- 上記 `claims/sync` 課題は §6 の P0 実行で解消済み（revision `reserve-api-00036-nss`）

## 3. 詳細ログ

### 3.1 migration 適用

実施:

- Cloud SQL Proxy 経由で DB 接続
- migration 一式を適用
- `schema_migrations` を直接照会して記録を確認

確認結果（`schema_migrations`）:

- `20260305_add_rls_to_tenants_audit_logs.sql`
  - version: `20260305`
  - checksum: `c1925fa63d87aa2f98d20a37a21376d499ec9a646af0a2325bea8dae9f9c6171`
  - applied_at: `2026-03-04 21:19:44.831686+00`
- `20260305_customers_line_unique_constraint.sql`
  - version: `20260305`
  - checksum: `4a856438a6bb6d52e20056cbbe671e8a788d193520aa852cebe4770c1264400d`
  - applied_at: `2026-03-04 21:19:45.264313+00`
- `20260305_fix_set_tenant_scope.sql`
  - version: `20260305`
  - checksum: `ff3a62e971663b10e926a61e4f364c40e3b5efa0f50267a857b4b9ba28afe295`
  - applied_at: `2026-03-04 21:19:45.656014+00`
- `20260306_v3_core_normalization_and_exports.sql`
  - version: `20260306`
  - checksum: `0ed68955c88a28058690623e04fa328cf4d1693e2f924aad0b510c98d798f53a`
  - applied_at: `2026-03-04 21:19:47.633983+00`
- `20260307_export_jobs_gcs_storage.sql`
  - version: `20260307`
  - checksum: `76dbfa4257905e377b0b6e0f6419b8c4642437d6221ed420e9fe97c07bee4e49`
  - applied_at: `2026-03-04 21:19:48.134344+00`

### 3.2 デプロイ整合

- Cloud Build（backend deploy）
  - build id: `055b7b59-4b57-4862-b65c-6ea15058d0ff`
  - 結果: `FAILURE`
  - 原因: `iam.serviceaccounts.actAs` 権限不足（Cloud Build 実行SA -> Cloud Run 実行SA）
- 迂回対応:
  - `gcloud run deploy` を手動実行し revision `reserve-api-00034-44b` を反映
  - onboarding 修正後に再 build/push
    - build id: `f6d5a0b8-e2a6-4db0-9814-bf7d738656c3`
    - image: `gcr.io/keyexpress-reserve/reserve-api:phaseb-fix-20260305063807`
  - 再 deploy で revision `reserve-api-00035-l2w` を 100% 配信

### 3.3 exports E2E（管理API）

実施フロー:

1. Firebase signup
2. `POST /api/platform/v1/onboarding/register`
3. Firebase token refresh（register で付与された tenant claim を反映）
4. `POST /api/v1/admin/exports`
5. `GET /api/v1/admin/exports/:id` を poll（`completed` まで）
6. `GET /api/v1/admin/exports/:id/download`

結果（代表実行）:

- tenant_id: `87df1bfa-1ab0-44f8-8632-e12f5751f8e3`
- tenant_key: `phaseb-salon-1772660580`
- export_job_id: `a8bc1735-2c20-4b61-a4b5-506c66a78342`
- `POST /api/v1/admin/exports`
  - status: `202`
  - body: `success=true`, `status=queued`
- `GET /api/v1/admin/exports/:id`
  - status: `200`
  - body: `status=completed`, `rowCount=0`
- `GET /api/v1/admin/exports/:id/download`
  - status: `200`

`Location` ヘッダー確認（別実行）:

- status: `202`
- `location: /api/v1/admin/exports/8975abc2-51ea-413e-819d-f67a74d767e3`

## 4. Phase B 判定

- 判定: **完了（exports smoke 通過）**
- Go 条件への影響:
  - migration/checksum/export smoke の観点は満たした
  - ただし `claims/sync` の既知課題を残すため、旧トークン利用ユーザー導線は別途フォローが必要

## 5. 既知課題（要フォロー）

注記:
- 本節は P0 着手前の既知課題記録。`claims/sync` 500 は §6 で解消済み。

1. `/api/platform/v1/admin/claims/sync` が 500

- 現象:
  - Cloud Run log: `invalid input syntax for type uuid: ""`
- 原因:
  - route 内の `admins` 参照が tenant context 未設定のまま RLS policy
    - `current_setting('app.current_tenant', true)::uuid`
  - 空文字キャストで失敗
- 影響:
  - tenant claim が未付与の既存管理者で claims 再同期が失敗
- 暫定回避:
  - 新規登録は `onboarding/register` が claims を直接付与するため、token refresh 後に admin API 利用可能

## 6. P0 実行ログ（claims/sync 500 解消, 2026-03-05 JST）

### 6.1 再現（修正前）

- 再現手順:
  1. Firebase signup
  2. `POST /api/platform/v1/onboarding/register`
  3. token refresh せずに `POST /api/platform/v1/admin/claims/sync`
- 再現結果:
  - tenant_id: `20393fa1-9e88-4b83-8cfc-c490dd12960e`
  - tenant_key: `claimssync-salon-1772662475`
  - `claims/sync` status: `500`
  - body: `{"success":false,"error":{"code":"INTERNAL_ERROR","message":"サーバーエラーが発生しました"}}`
- Cloud Run error log:
  - timestamp: `2026-03-04T22:14:36.800Z`
  - revision: `reserve-api-00035-l2w`
  - path: `/api/platform/v1/admin/claims/sync`
  - message: `invalid input syntax for type uuid: ""`

### 6.2 修正内容

- アプリ修正:
  - `backend-v2/src/services/admin-claims-sync.service.ts` を追加
    - `app.current_firebase_uid` を transaction-local に設定
    - RLS 下で `firebase_uid` から `tenant_id` を解決
  - `backend-v2/src/routes/platform/onboarding.routes.ts`
    - `/admin/claims/sync` を上記サービス経由に変更
- DB 修正:
  - migration 追加: `database/migrations/20260308_admins_claims_sync_rls.sql`
    - `admins.tenant_isolation` を `NULLIF(current_setting('app.current_tenant', true), '')::UUID` に変更（空文字キャスト防止）
    - `admins` に `firebase_uid_lookup` policy を追加（`app.current_firebase_uid` 一致時のみ SELECT 許可）
  - base schema 同期:
    - `database/schema/001_initial_schema.sql` の `admins` policy 定義を同等更新

### 6.3 テスト

- 追加:
  - `backend-v2/tests/unit/admin-claims-sync.service.test.ts`
    - 正常系: uid scope 設定 + tenant 解決
    - 異常系: admin 未存在時 `AuthorizationError`
- 実行:
  - `npm run test:ci -- tests/unit/admin-claims-sync.service.test.ts tests/unit/onboarding.service.test.ts`
  - `npm run typecheck`
- 結果:
  - すべて成功

### 6.4 migration 適用（staging）

- 適用方法:
  - Cloud SQL Proxy (`--gcloud-auth`) + `psql` で `20260308_admins_claims_sync_rls.sql` を適用
- `schema_migrations` 記録:
  - filename: `20260308_admins_claims_sync_rls.sql`
  - version: `20260308`
  - checksum: `8abccfadaeb0ac7be28edfb28154caf1f331a33e9c2659e50b66c6efdefd58ff`
  - applied_at: `2026-03-04 23:01:49.164327+00`

### 6.5 デプロイ

- build:
  - build id: `3f796188-e5e4-4b84-8029-2922ac878d31`
  - image: `gcr.io/keyexpress-reserve/reserve-api:claims-sync-fix-20260305-0802`
- deploy:
  - service: `reserve-api`
  - revision: `reserve-api-00036-nss`
  - traffic: `100%`

### 6.6 スモーク（修正後）

- 実施フロー:
  1. Firebase signup
  2. `POST /api/platform/v1/onboarding/register`
  3. `POST /api/platform/v1/admin/claims/sync`
  4. Firebase `signInWithPassword` で token refresh
  5. `POST /api/v1/admin/exports`
  6. `GET /api/v1/admin/exports/:id` poll
  7. `GET /api/v1/admin/exports/:id/download`
- 結果:
  - tenant_id: `0dde4580-5979-4c65-9195-3724faf1693a`
  - tenant_key: `claimssync-fix-salon-1772668581`
  - `claims/sync`: `200`
  - claims response tenant_id: `0dde4580-5979-4c65-9195-3724faf1693a`
  - refreshed JWT `tenantId` claim: `0dde4580-5979-4c65-9195-3724faf1693a`
  - `POST /api/v1/admin/exports`: `202` (`Location` あり)
  - export job final status: `completed`
  - `GET /download`: `200`
  - `GET /health`: `200` 相当（`success=true`）
  - `GET /ready`: `200` 相当（`ready=true`）

### 6.7 判定

- P0（`claims/sync` 500 解消）: **完了**
- 受け入れ基準:
  - `claims/sync` が `200` で `tenantId` を返却: **満たす**
  - token refresh 後に `/api/v1/admin/*` 到達: **満たす**（`/api/v1/admin/exports` E2E 成功）
