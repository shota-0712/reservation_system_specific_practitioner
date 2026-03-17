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

## 7. P1 実行ログ（Cloud Build `backend-deploy` の `actAs` 復旧, 2026-03-05 JST）

### 7.1 事前確認（修正前）

- 対象:
  - project: `keyexpress-reserve`
  - backend trigger SA: `486894262412-compute@developer.gserviceaccount.com`
  - runtime SA (`reserve-api`): `firebase-adminsdk-fbsvc@keyexpress-reserve.iam.gserviceaccount.com`
- `roles/iam.serviceAccountUser` の確認結果:
  - `gcloud iam service-accounts get-iam-policy ... --filter=roles/iam.serviceAccountUser ...`
  - 出力: **空**（未付与）
- 参考:
  - runtime SA 側には `roles/iam.serviceAccountTokenCreator` のみ付与されていた

### 7.2 IAM 修正

- 実施コマンド:
  - `gcloud iam service-accounts add-iam-policy-binding firebase-adminsdk-fbsvc@keyexpress-reserve.iam.gserviceaccount.com --project keyexpress-reserve --member serviceAccount:486894262412-compute@developer.gserviceaccount.com --role roles/iam.serviceAccountUser`
- 結果:
  - `Updated IAM policy for serviceAccount [...]`
  - `roles/iam.serviceAccountUser` が追加されたことを確認

### 7.3 復旧確認

- 再確認:
  - `roles/iam.serviceAccountUser` の絞り込みで member が返却されることを確認
- trigger 実行:
  - `gcloud builds triggers run reserve-backend --project keyexpress-reserve --region asia-northeast1 --branch=main`
  - build id: `7ee6c665-6e0a-4ac5-bf5b-c5ec127c125c`
  - status: `SUCCESS`
  - `backend-deploy`: `SUCCESS`
- Cloud Run 反映:
  - service: `reserve-api`
  - latest ready revision: `reserve-api-00038-rln`
  - traffic: `100%`

### 7.4 判定

- 再発防止:
  - `scripts/check_backend_deploy_iam.sh` を追加
  - 実行結果: `OK: roles/iam.serviceAccountUser binding is configured.`
  - `PROJECT_ID=keyexpress-reserve CB_REGION=asia-northeast1 ./scripts/check_cloudbuild_triggers.sh` は pass（serviceAccount 設定は warning、設定値は正常）
- P1（Cloud Build backend deploy 復旧）: **完了**
- 受け入れ基準:
  - `gcloud builds submit/trigger run` で backend deploy 成功: **満たす**
  - 手動 `gcloud run deploy` なしで最新 revision 反映: **満たす**

## 8. QA-001 実行ログ（Wave-A 統合スモーク標準化, 2026-03-06 JST）

### 8.1 目的と適用タイミング

- 目的:
  - Wave-A（`CRM-FE-001` / `APP-001` / `CRM-FE-002` / `CRM-FE-003` / `CRM-FE-004`）の統合動作を毎タスクで同一条件で確認する。
- 適用タイミング:
  - Wave-A 関連 PR を `main` へマージした直後（毎タスク）。
- 判定:
  - `Go`: §8.3 の自動チェックと §8.4 の手動チェックがすべて pass。
  - `No-Go`: 1つでも fail があれば、原因と切戻し/再実施条件を記録。

### 8.2 実行前パラメータ（固定）

```bash
export PROJECT_ID=keyexpress-reserve
export REGION=asia-northeast1
export CB_REGION=asia-northeast1
export BACKEND_TRIGGER_NAME=reserve-backend
export API_SERVICE=reserve-api
export TENANT_KEY=default

export API_URL="$(gcloud run services describe reserve-api --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
export ADMIN_URL="$(gcloud run services describe reserve-admin --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
export CUSTOMER_URL="$(gcloud run services describe reserve-customer --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"

# manager/owner の Firebase ID token（手動取得）
export ADMIN_ID_TOKEN="<FIREBASE_ID_TOKEN>"
```

### 8.3 自動チェック手順（毎回同順）

1) Lane-B ローカルゲート（回帰防止）

```bash
npm --prefix admin-dashboard run lint
npm --prefix admin-dashboard test
npm --prefix admin-dashboard run build
```

2) APP-001 構文/設定チェック

```bash
node --check customer-app/config.js
node --check customer-app/config.template.js
```

3) Lane-C 運用ゲート（IAM/Trigger）

```bash
PROJECT_ID="$PROJECT_ID" REGION="$REGION" BACKEND_TRIGGER_NAME="$BACKEND_TRIGGER_NAME" API_SERVICE="$API_SERVICE" ./scripts/check_backend_deploy_iam.sh
PROJECT_ID="$PROJECT_ID" CB_REGION="$CB_REGION" ./scripts/check_cloudbuild_triggers.sh
```

4) staging ヘルスチェック

```bash
curl -sS "$API_URL/health"
curl -sS "$API_URL/ready"
curl -I "$ADMIN_URL/login?tenant=$TENANT_KEY" | head -n 1
curl -I "$CUSTOMER_URL/?tenant=$TENANT_KEY" | head -n 1
```

5) CRM-FE-002（RFM閾値 GET/PUT 往復）

```bash
current="$(curl -sS -H "Authorization: Bearer $ADMIN_ID_TOKEN" -H "x-tenant-id: $TENANT_KEY" "$API_URL/api/v1/admin/settings/rfm-thresholds")"
payload="$(printf '%s' "$current" | jq -c '.data | {recency,frequency,monetary}')"
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_ID_TOKEN" -H "x-tenant-id: $TENANT_KEY" -H "Content-Type: application/json" \
  "$API_URL/api/v1/admin/settings/rfm-thresholds" \
  --data "$payload"
after="$(curl -sS -H "Authorization: Bearer $ADMIN_ID_TOKEN" -H "x-tenant-id: $TENANT_KEY" "$API_URL/api/v1/admin/settings/rfm-thresholds")"
test "$payload" = "$(printf '%s' "$after" | jq -c '.data | {recency,frequency,monetary}')"
```

6) CRM-FE-004（RFM再計算ジョブ）

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_ID_TOKEN" -H "x-tenant-id: $TENANT_KEY" \
  "$API_URL/api/v1/admin/jobs/customers/rfm/recalculate"
```

### 8.4 手動チェック手順（毎回同順）

1. `admin/settings`（予約設定）で RFM閾値を編集し、保存後リロードで値が保持されること。
2. `admin/settings`（予約設定）で不正入力（例: `recency score5 > score4`）時に保存がブロックされること。
3. `admin/customers` 一覧と `admin/customers/:id` 詳細でセグメント表示が一致すること。
4. 旧セグメント値（`vip` / `dormant` / `lost`）が混在しても画面がクラッシュしないこと。
5. `admin/integrations` の `RFM再計算実行` ボタン押下中にボタンが無効化され、成否メッセージが表示されること。
6. `customer-app` 本番URL（`$CUSTOMER_URL/?tenant=$TENANT_KEY`）でモック画面へ自動フォールバックしないこと。

### 8.5 毎タスク統合ログテンプレート（3回分）

#### Wave-A Smoke Template #1

- 実施日時:
- 実施者:
- 対象 Task ID / PR:
- 対象 revision（api/admin/customer）:
- 自動チェック結果（§8.3）:
  - Lane-B lint/test/build:
  - APP config check:
  - IAM/trigger check:
  - health/ready:
  - RFM GET/PUT roundtrip:
  - RFM recalculate API:
- 手動チェック結果（§8.4）:
  - settings RFM 保存・再読込:
  - settings RFM バリデーション:
  - customers 一覧/詳細一致:
  - 旧値フォールバック:
  - integrations 実行中UI/成否表示:
  - customer-app 非モック確認:
- 判定（Go / No-Go）:
- 不具合・フォローアップ:

#### Wave-A Smoke Template #2

- 実施日時:
- 実施者:
- 対象 Task ID / PR:
- 対象 revision（api/admin/customer）:
- 自動チェック結果（§8.3）:
  - Lane-B lint/test/build:
  - APP config check:
  - IAM/trigger check:
  - health/ready:
  - RFM GET/PUT roundtrip:
  - RFM recalculate API:
- 手動チェック結果（§8.4）:
  - settings RFM 保存・再読込:
  - settings RFM バリデーション:
  - customers 一覧/詳細一致:
  - 旧値フォールバック:
  - integrations 実行中UI/成否表示:
  - customer-app 非モック確認:
- 判定（Go / No-Go）:
- 不具合・フォローアップ:

#### Wave-A Smoke Template #3

- 実施日時:
- 実施者:
- 対象 Task ID / PR:
- 対象 revision（api/admin/customer）:
- 自動チェック結果（§8.3）:
  - Lane-B lint/test/build:
  - APP config check:
  - IAM/trigger check:
  - health/ready:
  - RFM GET/PUT roundtrip:
  - RFM recalculate API:
- 手動チェック結果（§8.4）:
  - settings RFM 保存・再読込:
  - settings RFM バリデーション:
  - customers 一覧/詳細一致:
  - 旧値フォールバック:
  - integrations 実行中UI/成否表示:
  - customer-app 非モック確認:
- 判定（Go / No-Go）:
- 不具合・フォローアップ:

## 9. QA-002 実行ログ（通知設定の回帰テスト追加, 2026-03-06 JST）

### 9.1 手動テストケース（read/write）

前提:
- manager 以上で admin にログイン済み
- `admin/settings` を開けること

ケース:

1. Read（初期表示）
  - `通知設定` タブを開く
  - 8種トグル（email/line/push）が表示される
  - 画面ロード時に `GET /api/v1/admin/settings/notifications` が `200` で返る

2. Write（単項目変更）
  - `新規予約通知` を ON/OFF 変更して保存
  - `PUT /api/v1/admin/settings/notifications` が `200` で返る
  - 成功メッセージ（`通知設定を保存しました`）が表示される

3. 永続化確認（再読込）
  - ページ再読込後、変更したトグル値が保持される
  - `GET` の戻り値とUI表示が一致する

4. 複数項目変更
  - email + line + push を複数変更して保存
  - 再読込後に全変更が保持される

5. 権限制御
  - `manager/owner` で `GET/PUT` が成功する
  - `staff` で `GET/PUT` は拒否（`403`）

6. 異常系
  - `PUT` 失敗時、画面にエラーバナー（`通知設定の読み込み/保存に失敗しました`）が表示される
  - タブ切替後も画面クラッシュしない

### 9.2 回帰チェック項目（既存タブ）

- `general`: 店舗情報保存が従来通り成功
- `hours`: 営業時間保存が従来通り成功
- `booking`: RFM 閾値のバリデーション/保存が従来通り成功
- `integrations`: LINE設定保存/プレビューが従来通り成功

### 9.3 不具合時の切り分け手順

1. UIでバナー内容を確認（read失敗かwrite失敗か）
2. ブラウザ Network で `GET/PUT /settings/notifications` の status / response を確認
3. API直叩きで再現確認（同一 token / tenant header）
4. `reserve-api` の Cloud Run ログで `error.code` と stack trace を確認
5. DBで対象テナントの `tenant_notification_settings` 行有無を確認
6. `updated_at` / `updated_by` の更新有無で保存可否を判定

## 10. OPS-003 実行ログ（staging cutover rehearsal, 2026-03-06 JST）

### 10.1 実施スコープ

- 目的:
  - Guardrails 準拠で cutover 前の運用成立性を確認する
- 対象環境:
  - project: `keyexpress-reserve`
  - region: `asia-northeast1`
  - revisions:
    - `reserve-api-00038-rln`
    - `reserve-admin-00035-5n2`
    - `reserve-customer-00009-79q`
- 実施方式:
  - preflight / health / rollback dry-run / Cloud Logging 実測（破壊操作なし）

### 10.2 実行結果（実測）

1. preflight（Lane-C gate）
  - `PROJECT_ID=keyexpress-reserve REGION=asia-northeast1 BACKEND_TRIGGER_NAME=reserve-backend API_SERVICE=reserve-api ./scripts/check_backend_deploy_iam.sh`
  - `PROJECT_ID=keyexpress-reserve CB_REGION=asia-northeast1 ./scripts/check_cloudbuild_triggers.sh`
  - 結果: pass（serviceAccount 設定は warning のみ）
  - 所要時間: `19s`

2. health / ready / UI疎通
  - `GET /health`: `200`
  - `GET /ready`: `200`（`ready=true`）
  - `GET admin /login`: `200`
  - `GET customer /?tenant=default`: `200`
  - 所要時間: `1s`

3. rollback dry-run
  - `PROJECT_ID=keyexpress-reserve REGION=asia-northeast1 API_SERVICE=reserve-api ADMIN_SERVICE=reserve-admin CUSTOMER_SERVICE=reserve-customer JOB_LOCATION=asia-northeast1 JOB_NAMES=reminder-day-before,reminder-same-day,daily-analytics,google-calendar-sync ./scripts/rollback_cutover.sh --resume-jobs`
  - 検出ロールバック先:
    - api: `reserve-api-00037-zwx`
    - admin: `reserve-admin-00034-ccx`
    - customer: `reserve-customer-00008-8z2`
  - 結果: dry-run 成功（scheduler jobs は staging に存在せず skip）
  - 所要時間: `7s`

4. API 実測（Cloud Logging, 直近60分）
  - 母数: `count=300`
  - p95 latency: `98ms`
  - 5xx: `7`（`2.33%`）
  - 4xx/5xx: `92`（`30.67%`）
  - 5xx 発生上位:
    - `/api/v1/default/admin/dashboard/activity?limit=20`（`4/120`）
    - `/api/v1/salon/admin/dashboard/activity?limit=20`（`3/60`）

### 10.3 Guardrails 判定

- SLO（全体所要時間 <= 45分）: **Pass**（今回の rehearsal 手順は `27s`）
- rollback dry-run 成立: **Pass**
- API error rate（5分連続 2.0% 超過で No-Go）:
  - 直近60分の 5xx 率が `2.33%` のため **Fail**

### 10.4 最終判定

- 判定: **No-Go**
- 理由:
  - `reserve-api` の 5xx 率が guardrails しきい値（`2.0%`）を超過
- 追加対応:
  1. `/api/v1/{tenant}/admin/dashboard/activity` の 5xx 原因を特定し修正
  2. 同手順で rehearsal を再実施し、5xx 率 <= 2.0% を確認
  3. 再実施記録を本 runbook に追記後、Go/No-Go を再判定

## 10.5 OPS-003 再実施ログ（dashboard/activity + onboarding smoke 修正後, 2026-03-06 JST）

### 10.5.1 実施内容

1. backend deploy（migration 含む）
  - build: `3726d1ab-c7f6-4243-ac36-255d914212f9`（`SUCCESS`）
  - api revision: `reserve-api-00041-prw`
2. backend deploy（route/script 修正の再反映, migration なし）
  - build: `8c316233-768d-4176-bb9f-ca0960c51c06`（`SUCCESS`）
  - api revision: `reserve-api-00042-99d`
3. smoke 再実行
  - `API_URL=https://reserve-api-czjwiprc2q-an.a.run.app FIREBASE_API_KEY=... RUN_RESERVATION_TEST=true ./scripts/smoke_public_onboarding.sh`
  - 結果: **完走成功**
    - `tenantSlug=smoke-salon-1772751809`
    - `reservationId=2655958e-2be3-4ff3-a293-b5309d09f46a`
    - `bookingLinkToken=z2_QIduw27_YnaTvfnSqXfsA01PSmnGE`
4. preflight 再確認（Lane-C gate）
  - `check_backend_deploy_iam.sh`: pass
  - `check_cloudbuild_triggers.sh`: pass（warning のみ）
5. customer deploy（tenantKey ヒント送信反映）
  - build: `40e53927-089b-43c9-b304-46b956bafebb`（`SUCCESS`）
  - customer revision: `reserve-customer-00010-4sx`
  - build 内 `customer-smoke`: `SUCCESS`

### 10.5.2 実測（latest revision: `reserve-api-00042-99d`）

- Cloud Logging 集計（requests log, sample `count=31`）
  - `p95 latency`: `300ms`
  - `5xx`: `0`（`0.00%`）
  - `4xx`: `2`

### 10.5.3 再判定

- Guardrails:
  - rollback dry-run: 既存結果 **Pass**（§10.2）
  - 5xx rate <= 2.0%: **Pass**（`0.00%`）
- 判定: **Go（staging rehearsal）**

### 10.5.4 補足

- `booking-links/resolve` は `tenantKey` ヒント付き経路を smoke / customer-app 側で利用可能にした。
- token-only 経路は strict RLS 環境で `404` になり得るため、運用上は `tenant`（または `tenantKey`）付きURLを推奨。

---

## 11. DB厳格マルチテナント是正 Wave-1（MT-A1〜A6）

**実施日**: 2026-03-06 JST
**実施者**: Codex（6-agent並列）

### 11.1 変更概要

| Agent | Task | 変更内容 |
|---|---|---|
| A1 | MT-A1 | `database/migrations/20260311_mt_wave1_rls_hardening.sql` 新規作成 |
| A2 | MT-A2 | `backend-v2/src/middleware/tenant.ts` の `getTenantByStoreCode` を `resolve_active_store_context` 経由に変更 |
| A3 | MT-A3 | `backend-v2/tests/unit/tenant.middleware.test.ts` を新仕様に全面更新（7テスト、42883 Fail-fast含む） |
| A4 | MT-A4 | `cloudbuild.yaml` / `run_migrations_cloudbuild.sh` / `create_cloudbuild_triggers.sh` / `generate_cutover_commands.sh` の migration 既定ユーザーを `app_user` → `migration_user` に変更 |
| A5 | MT-A5 | `DB_V3_SCHEMA_DEFINITION.md` / `API_DESIGN.md` / `DEPLOYMENT.md` / `jobs.admin.routes.ts` コメントの管理API経路を `/api/v1/admin` に統一 |
| A6 | MT-A6 | 統合検証・本記録 |

### 11.2 migration 内容（20260311_mt_wave1_rls_hardening.sql）

```sql
-- FORCE RLS 適用
ALTER TABLE tenant_rfm_settings          FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_notification_settings FORCE ROW LEVEL SECURITY;

-- store_code 解決関数
CREATE OR REPLACE FUNCTION resolve_active_store_context(p_store_code text)
RETURNS TABLE (tenant_id UUID, store_id UUID)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT s.tenant_id, s.id AS store_id FROM stores s
    WHERE s.store_code = p_store_code AND s.status = 'active' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_active_store_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_active_store_context(text) TO app_user;  -- ロール存在時のみ
```

### 11.3 品質ゲート結果

| コマンド | 結果 |
|---|---|
| `npm --prefix backend-v2 run lint` | **Pass**（エラーなし） |
| `npm --prefix backend-v2 run typecheck` | **Pass**（エラーなし） |
| `npm --prefix backend-v2 run test:ci -- tests/unit` | **Pass**（18 suites / 94 tests、42883 Fail-fast追加） |
| `npm --prefix backend-v2 run build` | **Pass**（エラーなし） |

### 11.4 成功条件チェックリスト

| ID | 条件 | 判定 |
|---|---|---|
| T1 | `tenant_rfm_settings` / `tenant_notification_settings` に `FORCE ROW LEVEL SECURITY` | staging SQL検証ペンディング（§11.6参照） |
| T2 | `resolve_active_store_context` の存在・`SECURITY DEFINER`・`EXECUTE(app_user)` | staging SQL検証ペンディング（§11.6参照） |
| T3〜T6 | store_code / slug / UUID 解決導線 | **Pass（単体テスト7件）** |
| T4 (Fail-fast) | 関数未適用時（`42883`）→ `next(error)` 伝播 | **Pass（単体テスト）** |
| T7 | 他テナントの `X-Store-Id` 指定 → 403 | **実装維持（既存動作）** |
| T8 | migration DB_USER 既定 = `migration_user` | **Pass（全4ファイル変更確認）** |
| T9 | docs 経路記述 = `/api/v1/admin` | **Pass（4ファイル修正）** |
| T5-doc | `migration_user` 既定が DEPLOYMENT.md / DB_V3_SCHEMA_DEFINITION.md に反映 | **Pass（C2完了）** |

### 11.6 staging SQL検証コマンド（T1/T2実施手順）

migration適用後に以下を実行し、結果をこのセクションに追記する。

```sql
-- T1: FORCE RLS 確認
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname IN ('tenant_rfm_settings', 'tenant_notification_settings');
-- 期待値: 両行とも relrowsecurity=t かつ relforcerowsecurity=t

-- T2a: 関数の存在と SECURITY DEFINER 確認
SELECT proname, prosecdef
FROM pg_proc
WHERE proname = 'resolve_active_store_context';
-- 期待値: proname='resolve_active_store_context', prosecdef=t

-- T2b: app_user への EXECUTE 権限確認
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name = 'resolve_active_store_context';
-- 期待値: grantee='app_user', privilege_type='EXECUTE'

-- T2c: PUBLIC への EXECUTE 権限がないことを確認
SELECT count(*) FROM information_schema.routine_privileges
WHERE routine_name = 'resolve_active_store_context'
  AND grantee = 'PUBLIC';
-- 期待値: count=0
```

**T1/T2 実測値**（staging実施時に下記フォーマットで記入）:

```
実施日時    : 2026-03-06 14:18 JST
Cloud Build ID : 9f84ffbe-4698-4932-9cdb-9a47a9b1e3f6
実行者      : shotahorie

T1 tenant_rfm_settings          relrowsecurity=t relforcerowsecurity=t
T1 tenant_notification_settings relrowsecurity=t relforcerowsecurity=t
T2a resolve_active_store_context prosecdef=t
T2b app_user EXECUTE             : 存在する
T2c PUBLIC EXECUTE count         : 0（期待値 0）
```

- 実施日時: **2026-03-06 14:18 JST**
- Cloud Build ID: **9f84ffbe-4698-4932-9cdb-9a47a9b1e3f6**（`db-migrations: SUCCESS`）
- 実行者: **shotahorie**
- T1 `relforcerowsecurity`: **tenant_rfm_settings=t / tenant_notification_settings=t**
- T2 `prosecdef`: **t**
- T2 `app_user EXECUTE`: **存在する**
- T2 `PUBLIC EXECUTE=0`: **0**
- staging判定: **Pass**

**MU-A1/MU-A3 実施ログ（2026-03-06 JST 追試）**:

- MU-A1 前提整備（認証）
  - `migration_user` を Cloud SQL に作成
  - `db-password-migration` を作成（version: 1）
  - `roles/secretmanager.secretAccessor` 付与:
    - `serviceAccount:486894262412@cloudbuild.gserviceaccount.com`
    - `serviceAccount:486894262412-compute@developer.gserviceaccount.com`
  - 補助 Build ID: **89a98213-538d-42a6-b550-e281b40e1069**（`grant-migration-user: SUCCESS`）
- MU-A3 staging migration（`_DB_USER=migration_user,_DB_PASSWORD_SECRET=db-password-migration`）2回連続
  - 1回目 Build ID: **a2c5401f-d98b-4e4c-b9ed-ac6d15de7225**（`SUCCESS`）
  - 2回目 Build ID: **dfd7c563-a306-469d-b2b3-f08f960b84d0**（`SUCCESS`）
  - 両回とも `Skip migration: ... (already applied with matching checksum)` を確認（idempotent）
- T1/T2 再計測（Build ID: **36bcf820-9ba4-4c56-9ad0-b23c6f06a663**, `SUCCESS`）
  - T1 `tenant_notification_settings`: `relrowsecurity=true`, `relforcerowsecurity=true`
  - T1 `tenant_rfm_settings`: `relrowsecurity=true`, `relforcerowsecurity=true`
  - T2a `resolve_active_store_context`: `prosecdef=true`
  - T2b `app_user EXECUTE`: `存在する`
  - T2c `PUBLIC EXECUTE count`: `0`
  - staging判定: **Pass**

### 11.7 判定

- ローカル品質ゲート: **Go**（lint/typecheck/test 94/build 全Pass）
- Fail-fast方針: **固定済み**（42883=undefined_function は non-recoverable として伝播）
- ドキュメント整合: **Go**（C2完了）
- MU-A3（`migration_user` + `db-password-migration` 2回連続）: **Pass**
- staging SQL検証（T1/T2）: **Pass（§11.6 実測値記入済み）**
- 総合判定: **Go（staging確定 2026-03-06 JST）**

## 12. MU-A2 本番 trigger 更新・本番反映（2026-03-06 JST）

### 12.1 目的

`reserve-backend` trigger の `_DB_USER` / `_DB_PASSWORD_SECRET` 既定値を MU-A2 方針（`migration_user` / `db-password-migration`）に本番適用する。

### 12.2 実施内容

1. **Preflight**
   - trigger serviceAccount: `486894262412-compute@developer.gserviceaccount.com`
   - IAM check: `OK（roles/iam.serviceAccountUser 確認済み）`
   - 直前 revision: `reserve-api-00042-99d`

2. **Trigger 更新**（`gcloud builds triggers import` 方式）
   - 更新前: `_DB_USER=app_user`, `_DB_PASSWORD_SECRET` なし
   - 更新後: `_DB_USER=migration_user`, `_DB_PASSWORD_SECRET=db-password-migration`
   - 方法: `gcloud builds triggers describe --format=json` → Python で substitutions 修正 → `gcloud builds triggers import --source`
   - 結果: **成功**

3. **本番反映**
   - Build ID: **de8581ef-b19c-47ad-9f19-10a4e1af5081**
   - startTime: `2026-03-06T11:06:24Z`
   - finishTime: `2026-03-06T11:09:39Z`（所要 ~3分）
   - status: **SUCCESS**
   - logUrl: `https://console.cloud.google.com/cloud-build/builds;region=asia-northeast1/de8581ef-b19c-47ad-9f19-10a4e1af5081?project=486894262412`

4. **事後健全性確認**
   - `/health`: `{"status":"healthy"}` ✓
   - `/ready`: `{"ready":true, "database":true, "firebase":true, "googleOauthConfigured":true}` ✓

### 12.3 判定

- **Go（本番 trigger 更新・本番反映完了 2026-03-06 20:30 JST）**

---

## 13. trigger 更新標準手順化（MU-A2 再発防止）

更新日: 2026-03-06

### 13.1 背景

MU-A2 にて `gcloud builds triggers update github --update-substitutions` が `INVALID_ARGUMENT` で失敗した。
原因: 2nd gen trigger（repositoryEventConfig）は `--update-substitutions` フラグを受け付けない場合がある。
回避策として `describe → Python手編集 → import` を手作業で実施。

### 13.2 標準化内容

`scripts/create_cloudbuild_triggers.sh` に `TRIGGER_UPDATE_STRATEGY=auto|update|import` を追加した。

- **`auto`（default）**: update 試行 → `INVALID_ARGUMENT` (exit 21) 検出 → `import` フォールバック自動実行
- **`update`**: update のみ（フォールバックなし）
- **`import`**: 即 `describe → patch → import`

同じ失敗が再発しても手作業 Python 編集は不要。`TRIGGER_UPDATE_STRATEGY` 明示指定なしで再発防止が効く。

### 13.3 判定

- **標準手順化完了（2026-03-06）**
