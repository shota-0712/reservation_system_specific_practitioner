# デプロイ手順書

本ドキュメントでは、予約システムをGoogle Cloud Platform (GCP) にデプロイする手順を説明します。

## 前提条件

- Google Cloud アカウント
- Firebase プロジェクト
- LINE Developers アカウント
- `gcloud` CLI インストール済み

---

## 1. GCPプロジェクト設定

### 1.1 プロジェクト作成

```bash
# プロジェクト作成
gcloud projects create YOUR_PROJECT_ID --name="Reserve System"

# プロジェクト選択
gcloud config set project YOUR_PROJECT_ID

# 課金有効化（ブラウザで実施）
# https://console.cloud.google.com/billing
```

### 1.2 必要なAPIの有効化

```bash
gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  cloudscheduler.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  containerregistry.googleapis.com
```

---

## 2. Cloud SQL (PostgreSQL) 設定

### 2.1 インスタンス作成

```bash
# Cloud SQLインスタンス作成
gcloud sql instances create reservation-system-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=asia-northeast1 \
  --storage-type=SSD \
  --storage-size=10GB

# データベース作成
gcloud sql databases create reservation_system --instance=reservation-system-db

# ユーザー作成
gcloud sql users create app_user \
  --instance=reservation-system-db \
  --password=YOUR_SECURE_PASSWORD
```

### 2.2 スキーマ適用

```bash
# Cloud SQL Proxy経由で接続（ローカル）
./cloud_sql_proxy -instances=YOUR_PROJECT_ID:asia-northeast1:reservation-system-db=tcp:5432 &

# スキーマ適用
psql -h 127.0.0.1 -U app_user -d reservation_system -f database/schema/001_initial_schema.sql

# 既存環境の差分適用（必要なものを順に実行）
psql -h 127.0.0.1 -U app_user -d reservation_system -f database/migrations/20260131_schema_update_v2_1.sql
psql -h 127.0.0.1 -U app_user -d reservation_system -f database/migrations/20260202_options_and_service_message_logs.sql
psql -h 127.0.0.1 -U app_user -d reservation_system -f database/migrations/20260209_unification_core.sql
psql -h 127.0.0.1 -U app_user -d reservation_system -f database/migrations/20260209_daily_analytics_breakdowns.sql
```

---

## 3. Secret Manager 設定

```bash
# データベースパスワード
echo -n "YOUR_DB_PASSWORD" | gcloud secrets create db-password --data-file=-

# データベースホスト（Cloud SQL接続）
echo -n "/cloudsql/YOUR_PROJECT_ID:asia-northeast1:reservation-system-db" | \
  gcloud secrets create db-host --data-file=-

# 暗号化キー（32文字）
echo -n "your-32-character-encryption-key" | \
  gcloud secrets create encryption-key --data-file=-

# ジョブ実行シークレット
echo -n "YOUR_JOB_SECRET" | gcloud secrets create job-secret --data-file=-
```

Firebase Admin SDK について:
- Cloud Run 本番では **Application Default Credentials (ADC)** を使用する（サービスアカウント鍵JSONは不要）
- 組織ポリシーで「サービスアカウント鍵の作成」が禁止されている場合は、鍵JSONを作らずに進める
- 必要に応じて Cloud Run のサービスアカウント（デフォルト: `PROJECT_NUMBER-compute@developer.gserviceaccount.com`）へ Firebase 権限を付与する（例: `roles/firebase.admin`）

```bash
# Cloud Runサービスアカウントに権限付与
gcloud secrets add-iam-policy-binding db-password \
  --member="serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
# 他のシークレットにも同様に設定

# Cloud Build で migration 実行する場合は Cloud Build SA にも付与
gcloud secrets add-iam-policy-binding db-password \
  --member="serviceAccount:YOUR_PROJECT_NUMBER@cloudbuild.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 3.1 シークレット漏えい時のローテーション手順（Google OAuth Client Secret）

1. Google Cloud Console の OAuth クライアントで `Client Secret` を再発行する。  
2. Secret Manager に新しい version を追加する。

```bash
printf %s "NEW_GOOGLE_OAUTH_CLIENT_SECRET" | \
  gcloud secrets versions add google-oauth-client-secret --data-file=-
```

3. backend を再デプロイして `latest` を読み込ませる。

```bash
gcloud builds submit . --config=cloudbuild.yaml \
  --substitutions=_DEPLOY_TARGET=backend,\
_RUN_MIGRATIONS=false,\
_RUN_INTEGRATION=false,\
_WRITE_FREEZE_MODE=false,\
_CLOUDSQL_CONNECTION=YOUR_PROJECT_ID:asia-northeast1:reservation-system-db,\
_DB_USER=app_user,\
_DB_NAME=reservation_system,\
_NEXT_PUBLIC_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID,\
_GOOGLE_OAUTH_CLIENT_ID=YOUR_CLIENT_ID,\
_GOOGLE_OAUTH_REDIRECT_URI=YOUR_REDIRECT_URI
```

4. `/ready` で `checks.googleOauthConfigured=true` を確認する。  
5. 旧 secret version を無効化する。

```bash
gcloud secrets versions list google-oauth-client-secret
gcloud secrets versions disable OLD_VERSION --secret=google-oauth-client-secret
```

---

## 4. Firebase設定

### 4.1 Firebase Console

1. [Firebase Console](https://console.firebase.google.com/) でプロジェクト作成
2. **Authentication** を有効化
   - 「メール/パスワード」サインインを有効化
3. （任意）**プロジェクトの設定** → **サービスアカウント**
   - 組織ポリシーで鍵作成が許可されている場合のみ「新しい秘密鍵を生成」で JSON をダウンロード
   - 鍵作成が禁止されている場合はスキップ（Cloud Run は ADC で動作する）

### 4.2 管理者アカウント作成

Firebase Consoleの「Authentication」→「Users」から手動で管理者アカウントを追加

または、初回セットアップ時のみ Admin Dashboard の `"/signup"` 画面で新規登録できます。
- 例: `https://reserve-admin-xxxxx.run.app/signup`
- 条件: 該当テナントの `admins` レコードが 0 件のときのみ
- 初回 API 呼び出し時に owner 権限が自動作成されます

---

## 5. LINE Developers設定

### 5.1 Messaging API チャネル作成

1. [LINE Developers Console](https://developers.line.biz/) にログイン
2. プロバイダー作成
3. 「Messaging API」チャネル作成
4. 以下を取得：
   - Channel ID
   - Channel Secret
   - Channel Access Token

### 5.2 LIFF アプリ作成

1. チャネル設定 → 「LIFF」タブ
2. 「追加」をクリック
3. 設定：
   - サイズ: Full
   - エンドポイントURL: `https://reserve-customer-xxxxx.run.app`（デプロイ後に設定）
   - BLE feature: OFF
4. LIFF IDを取得

---

## 6. デプロイ実行

### 6.1 環境変数の準備

```bash
# substitutionsファイル作成
cat > cloudbuild-substitutions.yaml << EOF
substitutions:
  _WRITE_FREEZE_MODE: "false"
  _NEXT_PUBLIC_API_URL: https://reserve-api-xxxxx.run.app
  _CUSTOMER_API_URL: https://reserve-api-xxxxx.run.app
  _CUSTOMER_TENANT_KEY: demo-salon
  _NEXT_PUBLIC_TENANT_ID: demo-salon
  _NEXT_PUBLIC_ADMIN_URL: https://reserve-admin-xxxxx.run.app
  _NEXT_PUBLIC_FIREBASE_API_KEY: YOUR_FIREBASE_API_KEY
  _NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: YOUR_PROJECT_ID.firebaseapp.com
  _NEXT_PUBLIC_FIREBASE_PROJECT_ID: YOUR_PROJECT_ID
  _CLOUDSQL_CONNECTION: YOUR_PROJECT_ID:asia-northeast1:reservation-system-db
EOF
```

### 6.2 Cloud Build実行

```bash
# 全サービスをデプロイ
gcloud builds submit . --config=cloudbuild.yaml \
  --substitutions=_NEXT_PUBLIC_API_URL=https://reserve-api-xxxxx.run.app,\
_CUSTOMER_API_URL=https://reserve-api-xxxxx.run.app,\
_CUSTOMER_TENANT_KEY=demo-salon,\
_NEXT_PUBLIC_TENANT_ID=demo-salon,\
_NEXT_PUBLIC_ADMIN_URL=https://reserve-admin-xxxxx.run.app,\
_NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_API_KEY,\
_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT_ID.firebaseapp.com,\
_NEXT_PUBLIC_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID,\
_WRITE_FREEZE_MODE=false,\
_CLOUDSQL_CONNECTION=YOUR_PROJECT_ID:asia-northeast1:reservation-system-db

# バックエンドのみデプロイ（quality/integration/migration/backend deploy のみ実行）
gcloud builds submit . --config=cloudbuild.yaml \
  --substitutions=_DEPLOY_TARGET=backend,\
_RUN_INTEGRATION=true,\
_RUN_MIGRATIONS=true,\
_WRITE_FREEZE_MODE=false,\
_CLOUDSQL_INSTANCE=reservation-system-db,\
_DB_USER=app_user,\
_DB_NAME=reservation_system,\
_NEXT_PUBLIC_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID,\
_CLOUDSQL_CONNECTION=YOUR_PROJECT_ID:asia-northeast1:reservation-system-db

# 管理画面のみデプロイ
gcloud builds submit . --config=cloudbuild.yaml \
  --substitutions=_DEPLOY_TARGET=admin,\
_NEXT_PUBLIC_API_URL=https://reserve-api-xxxxx.run.app,\
_NEXT_PUBLIC_TENANT_ID=demo-salon,\
_NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_API_KEY,\
_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT_ID.firebaseapp.com,\
_NEXT_PUBLIC_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID

# 顧客アプリのみデプロイ
gcloud builds submit . --config=cloudbuild.yaml \
  --substitutions=_DEPLOY_TARGET=customer,\
_CUSTOMER_API_URL=https://reserve-api-xxxxx.run.app,\
_CUSTOMER_TENANT_KEY=demo-salon

# DB migration を同時実行する場合
gcloud builds submit . --config=cloudbuild.yaml \
  --substitutions=_NEXT_PUBLIC_API_URL=https://reserve-api-xxxxx.run.app,\
_CUSTOMER_API_URL=https://reserve-api-xxxxx.run.app,\
_CUSTOMER_TENANT_KEY=demo-salon,\
_NEXT_PUBLIC_TENANT_ID=demo-salon,\
_NEXT_PUBLIC_ADMIN_URL=https://reserve-admin-xxxxx.run.app,\
_NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_API_KEY,\
_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT_ID.firebaseapp.com,\
_NEXT_PUBLIC_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID,\
_CLOUDSQL_CONNECTION=YOUR_PROJECT_ID:asia-northeast1:reservation-system-db,\
_RUN_INTEGRATION=true,\
_RUN_MIGRATIONS=true,\
_WRITE_FREEZE_MODE=false,\
_CLOUDSQL_INSTANCE=reservation-system-db,\
_DB_USER=app_user,\
_DB_NAME=reservation_system

# ランディングページのみデプロイ
gcloud builds submit . --config=cloudbuild.yaml \
  --substitutions=_DEPLOY_TARGET=landing,\
_NEXT_PUBLIC_ADMIN_URL=https://reserve-admin-xxxxx.run.app
```

`_RUN_MIGRATIONS=true` の場合:
- `database/migrations/*.sql` をファイル名昇順で確認
- `schema_migrations` に未登録のファイルのみ適用
- 適用後に `schema_migrations(filename, checksum, applied_at)` へ記録

`_DEPLOY_TARGET` 指定時:
- 指定対象以外の quality/build/push/deploy ステップは実行せず成功終了する
- `backend` 以外を指定した場合、`_RUN_MIGRATIONS` と `_RUN_INTEGRATION` は無視される
- `backend` は `_WRITE_FREEZE_MODE` で書き込み凍結状態を指定できる（`true`/`false`）

### 6.3 品質ゲート（ローカル実行）

```bash
# Backend
cd backend-v2
npm ci
npm run lint
npm run typecheck
npm run test:ci
npm run build

# Admin Dashboard
cd ../admin-dashboard
npm ci
npm run lint
npm run build

# Integration tests (必要時のみ)
RUN_INTEGRATION=true npm run test:integration
```

### 6.4 Cloud Scheduler設定（リマインダー）

```bash
# 前日リマインダー（毎日 09:00 JST）
gcloud scheduler jobs create http reminder-day-before \
  --location=asia-northeast1 \
  --schedule="0 9 * * *" \
  --time-zone="Asia/Tokyo" \
  --uri="https://reserve-api-xxxxx.run.app/api/v1/demo-salon/jobs/reminders/day-before" \
  --http-method=POST \
  --headers="x-job-secret=YOUR_JOB_SECRET"

# 当日リマインダー（毎日 08:00 JST）
gcloud scheduler jobs create http reminder-same-day \
  --location=asia-northeast1 \
  --schedule="0 8 * * *" \
  --time-zone="Asia/Tokyo" \
  --uri="https://reserve-api-xxxxx.run.app/api/v1/demo-salon/jobs/reminders/same-day" \
  --http-method=POST \
  --headers="x-job-secret=YOUR_JOB_SECRET"

# 日次集計（毎日 00:30 JST / 前日分）
gcloud scheduler jobs create http daily-analytics \
  --location=asia-northeast1 \
  --schedule="30 0 * * *" \
  --time-zone="Asia/Tokyo" \
  --uri="https://reserve-api-xxxxx.run.app/api/v1/demo-salon/jobs/analytics/daily" \
  --http-method=POST \
  --headers="x-job-secret=YOUR_JOB_SECRET"

# Google Calendar 同期補償（5分ごと）
gcloud scheduler jobs create http google-calendar-sync \
  --location=asia-northeast1 \
  --schedule="*/5 * * * *" \
  --time-zone="Asia/Tokyo" \
  --uri="https://reserve-api-xxxxx.run.app/api/v1/demo-salon/jobs/integrations/google-calendar/sync" \
  --http-method=POST \
  --headers="x-job-secret=YOUR_JOB_SECRET"
```

運用ジョブ一覧（固定）:
- `reminder-day-before`: 毎日 `09:00` (Asia/Tokyo)
- `reminder-same-day`: 毎日 `08:00` (Asia/Tokyo)
- `daily-analytics`: 毎日 `00:30` (Asia/Tokyo)
- `google-calendar-sync`: `5分ごと` (Asia/Tokyo)

手動実行 API（管理画面と同等、Manager/Owner 認証必須）:
- `POST /api/v1/{tenantKey}/admin/jobs/reminders/day-before`
- `POST /api/v1/{tenantKey}/admin/jobs/reminders/same-day`
- `POST /api/v1/{tenantKey}/admin/jobs/analytics/daily`（`{ "date": "YYYY-MM-DD" }` 任意）
- `POST /api/v1/{tenantKey}/admin/jobs/integrations/google-calendar/sync`（`{ "limit": 50 }` 任意）

### 6.5 Cloud Build Trigger分割（backend/admin/customer/landing）

```bash
PROJECT_ID=YOUR_PROJECT_ID \
GITHUB_OWNER=YOUR_GITHUB_OWNER \
GITHUB_REPO=YOUR_GITHUB_REPO \
NEXT_PUBLIC_API_URL=https://reserve-api-xxxxx.run.app \
NEXT_PUBLIC_ADMIN_URL=https://reserve-admin-xxxxx.run.app \
NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_API_KEY \
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT_ID.firebaseapp.com \
NEXT_PUBLIC_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID \
CLOUDSQL_CONNECTION=YOUR_PROJECT_ID:asia-northeast1:reservation-system-db \
CLOUDSQL_INSTANCE=reservation-system-db \
CUSTOMER_TENANT_KEY=demo-salon \
NEXT_PUBLIC_TENANT_ID=demo-salon \
RUN_INTEGRATION=true \
RUN_MIGRATIONS=true \
WRITE_FREEZE_MODE=false \
READINESS_REQUIRE_LINE=false \
READINESS_REQUIRE_GOOGLE_OAUTH=true \
PUBLIC_ONBOARDING_ENABLED=true \
./scripts/create_cloudbuild_triggers.sh
```

作成される Trigger:
- `reserve-backend` (`_DEPLOY_TARGET=backend`)
- `reserve-admin` (`_DEPLOY_TARGET=admin`)
- `reserve-customer` (`_DEPLOY_TARGET=customer`)
- `reserve-landing` (`_DEPLOY_TARGET=landing`)

注記:
- `scripts/create_cloudbuild_triggers.sh` は update-or-create 動作。既存 trigger は更新される
- service account 不整合（run時エラー原因）は自動検出される
- 健全性チェック:

```bash
PROJECT_ID=YOUR_PROJECT_ID \
CB_REGION=asia-northeast1 \
./scripts/check_cloudbuild_triggers.sh
```

- PRラベル初期化（任意・`gh` CLI）:

```bash
GITHUB_REPO=YOUR_GITHUB_OWNER/YOUR_GITHUB_REPO \
./scripts/ensure_github_labels.sh
```

- 本番デプロイ対象ブランチは `main` のみ（`BRANCH_PATTERN=^main$`）
- `codex/*` ブランチは検証専用

### 6.6 切替コマンドシート自動生成

```bash
PROJECT_ID=YOUR_PROJECT_ID \
NEXT_PUBLIC_API_URL=https://reserve-api-xxxxx.run.app \
NEXT_PUBLIC_ADMIN_URL=https://reserve-admin-xxxxx.run.app \
NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_API_KEY \
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT_ID.firebaseapp.com \
NEXT_PUBLIC_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID \
NEXT_PUBLIC_TENANT_ID=demo-salon \
CLOUDSQL_CONNECTION=YOUR_PROJECT_ID:asia-northeast1:reservation-system-db \
CLOUDSQL_INSTANCE=reservation-system-db \
./scripts/generate_cutover_commands.sh
```

出力:
- `docs/runbooks/CUTOVER_COMMANDS.generated.md`
- 切替当日の freeze/deploy/unfreeze/rollback/decommission を値埋め込み済みで実行可能

---

## 7. カスタムドメイン設定（オプション）

### 7.1 Cloud Run にドメインをマッピング

```bash
# ランディングページ
gcloud run domain-mappings create \
  --service=reserve-landing \
  --domain=reserve-system.com \
  --region=asia-northeast1

# 管理画面
gcloud run domain-mappings create \
  --service=reserve-admin \
  --domain=admin.reserve-system.com \
  --region=asia-northeast1

# 顧客アプリ
gcloud run domain-mappings create \
  --service=reserve-customer \
  --domain=app.reserve-system.com \
  --region=asia-northeast1

# API
gcloud run domain-mappings create \
  --service=reserve-api \
  --domain=api.reserve-system.com \
  --region=asia-northeast1
```

### 7.2 DNS設定

Cloud Run が表示するCNAMEレコードをDNSプロバイダーに設定

---

## 8. テナント初期設定（公開セルフ登録）

SQL手作業は不要です。  
`reserve-admin` の `/register` から美容室テナントを作成し、`/onboarding` で初期設定を完了してください。

1. `https://reserve-admin-xxxxx.run.app/register` を開く  
2. サロン名 / slug / オーナー情報を入力して登録  
3. 自動遷移した `/onboarding` で以下を完了
   - 店舗情報
   - 営業設定
   - 初期メニュー / スタッフ
   - Google連携（必須）

### 8.1 CLIスモーク（登録 -> オンボーディング -> 予約作成）

公開セルフ登録と最低限の業務導線をCLIで一括確認できます。

```bash
API_URL=https://reserve-api-xxxxx.run.app \
FIREBASE_API_KEY=YOUR_FIREBASE_WEB_API_KEY \
CUSTOMER_URL=https://reserve-customer-xxxxx.run.app \
./scripts/smoke_public_onboarding.sh
```

オプション（必要時のみ）:
- `TENANT_SLUG=smoke-xxxx`（固定slugを使う）
- `RUN_RESERVATION_TEST=false`（登録・オンボーディング確認のみ）

---

## 9. 確認事項

### デプロイ後チェックリスト

- [ ] Backend API ヘルスチェック: `https://reserve-api-xxxxx.run.app/health`
- [ ] Readiness チェック: `https://reserve-api-xxxxx.run.app/ready`
  - [ ] `checks.database=true`
  - [ ] `checks.firebase=true`
  - [ ] `required.line` が運用ポリシーどおり（当面は `false`）
  - [ ] `required.googleOauthConfigured=true` かつ `checks.googleOauthConfigured=true`
  - [ ] 切替完了後は `checks.writeFreezeMode=false`
- [ ] Admin Dashboard `/register` と `/onboarding` 表示
- [ ] Customer App 表示確認
- [ ] Landing Page 表示確認
- [ ] LIFF エンドポイントURL更新
- [ ] LINE公式アカウントのリッチメニュー設定

---

## 10. 一括切替ランブック（計画停止あり）

事前に共通変数を設定:

```bash
export PROJECT_ID=YOUR_PROJECT_ID
export REGION=asia-northeast1
export API_SERVICE=reserve-api
export ADMIN_SERVICE=reserve-admin
export CUSTOMER_SERVICE=reserve-customer
export JOB_LOCATION=asia-northeast1
```

1. 切替前日
   - デプロイアーティファクトを固定（`SHORT_SHA` 確定）。
   - `backend-v2` / `admin-dashboard` / `customer-app` の品質ゲート結果を凍結。
   - 運用担当（監視・DB・LINE）承認を取得。
2. 切替開始
   - 旧系書き込みを凍結（予約作成/変更/キャンセルを停止）。
   - 実行コマンド:
   ```bash
   gcloud run services update ${API_SERVICE} \
     --project ${PROJECT_ID} \
     --region ${REGION} \
     --update-env-vars=WRITE_FREEZE_MODE=true
   ```
   - Cloud Scheduler のジョブを一時停止（`reminder-day-before`, `reminder-same-day`, `daily-analytics`, `google-calendar-sync`）。
   - 実行コマンド:
   ```bash
   gcloud scheduler jobs pause reminder-day-before --project ${PROJECT_ID} --location ${JOB_LOCATION}
   gcloud scheduler jobs pause reminder-same-day --project ${PROJECT_ID} --location ${JOB_LOCATION}
   gcloud scheduler jobs pause daily-analytics --project ${PROJECT_ID} --location ${JOB_LOCATION}
   gcloud scheduler jobs pause google-calendar-sync --project ${PROJECT_ID} --location ${JOB_LOCATION}
   ```
   - DBバックアップ取得。
3. 本番反映
   - `gcloud builds submit` を `_RUN_INTEGRATION=true,_RUN_MIGRATIONS=true,_WRITE_FREEZE_MODE=true` で実行。
   - デプロイ順序は `backend-v2` → `admin-dashboard` → `customer-app` を維持。
4. 検証
   - `/health` と `/ready` を確認。
   - スモーク（予約作成・変更・キャンセル・通知・Google同期）を30分以内に完了。
5. 開放
   - 書き込み凍結を解除。
   - 実行コマンド:
   ```bash
   gcloud run services update ${API_SERVICE} \
     --project ${PROJECT_ID} \
     --region ${REGION} \
     --update-env-vars=WRITE_FREEZE_MODE=false
   ```
   - Cloud Scheduler ジョブを再開。
   - 実行コマンド:
   ```bash
   gcloud scheduler jobs resume reminder-day-before --project ${PROJECT_ID} --location ${JOB_LOCATION}
   gcloud scheduler jobs resume reminder-same-day --project ${PROJECT_ID} --location ${JOB_LOCATION}
   gcloud scheduler jobs resume daily-analytics --project ${PROJECT_ID} --location ${JOB_LOCATION}
   gcloud scheduler jobs resume google-calendar-sync --project ${PROJECT_ID} --location ${JOB_LOCATION}
   ```
   - アラートダッシュボードを30分監視。
6. 旧系廃止
   - 旧 `backend` のCloud Runサービス停止。
   - 旧経路のルーティングとシークレットを失効。
   - Runbookと構成図を更新。
   - 実行コマンド:
   ```bash
   PROJECT_ID=${PROJECT_ID} \
   REGION=${REGION} \
   OLD_BACKEND_SERVICE=reserve-api-legacy \
   OLD_BACKEND_DOMAINS=api-legacy.reserve-system.com \
   OLD_BACKEND_SECRET_NAMES=old-db-password,old-line-token \
   OLD_BACKEND_SERVICE_ACCOUNT=old-backend-sa@${PROJECT_ID}.iam.gserviceaccount.com \
   ./scripts/decommission_old_backend.sh --apply
   ```

### 10.1 切戻し手順（デプロイ失敗時）

1. 1コマンド切戻し（推奨）
   ```bash
   PROJECT_ID=${PROJECT_ID} \
   REGION=${REGION} \
   API_SERVICE=${API_SERVICE} \
   ADMIN_SERVICE=${ADMIN_SERVICE} \
   CUSTOMER_SERVICE=${CUSTOMER_SERVICE} \
   ./scripts/rollback_cutover.sh --apply
   ```
   - 既知の安定Revisionを固定したい場合:
   ```bash
   PROJECT_ID=${PROJECT_ID} \
   REGION=${REGION} \
   API_SERVICE=${API_SERVICE} \
   ADMIN_SERVICE=${ADMIN_SERVICE} \
   CUSTOMER_SERVICE=${CUSTOMER_SERVICE} \
   STABLE_API_REVISION=reserve-api-00012-abc \
   STABLE_ADMIN_REVISION=reserve-admin-00009-def \
   STABLE_CUSTOMER_REVISION=reserve-customer-00007-ghi \
   ./scripts/rollback_cutover.sh --apply
   ```
2. 凍結は維持したまま原因調査
   - `WRITE_FREEZE_MODE=true` のまま `/ready` とアプリログで障害原因を特定。
3. 復旧が確認できたら再開
   - `WRITE_FREEZE_MODE=false` に戻し、Schedulerを再開。
   - ジョブ再開まで含めて切戻しする場合:
   ```bash
   PROJECT_ID=${PROJECT_ID} \
   REGION=${REGION} \
   API_SERVICE=${API_SERVICE} \
   ADMIN_SERVICE=${ADMIN_SERVICE} \
   CUSTOMER_SERVICE=${CUSTOMER_SERVICE} \
   JOB_LOCATION=${JOB_LOCATION} \
   ./scripts/rollback_cutover.sh --apply --resume-jobs
   ```

### 10.2 旧backend廃止スクリプト

`./scripts/decommission_old_backend.sh` は以下を一括実行する:
- 旧 Cloud Run サービス削除
- 旧ドメインマッピング削除（`OLD_BACKEND_DOMAINS` 指定時）
- 旧シークレットversion無効化（`OLD_BACKEND_SECRET_NAMES` 指定時）
- 旧サービスアカウント無効化（`OLD_BACKEND_SERVICE_ACCOUNT` 指定時）

dry-run（デフォルト）:
```bash
PROJECT_ID=${PROJECT_ID} \
REGION=${REGION} \
OLD_BACKEND_SERVICE=reserve-api-legacy \
./scripts/decommission_old_backend.sh
```

---

## トラブルシューティング

### Cloud Runログ確認

```bash
gcloud run services logs read reserve-api --region=asia-northeast1
```

### Cloud SQLへの接続

```bash
gcloud sql connect reservation-system-db --user=app_user --database=reservation_system
```

---

## 推定コスト（月額）

| サービス | 推定コスト |
|---------|-----------|
| Cloud Run (API) | ¥3,000 - ¥10,000 |
| Cloud Run (Admin) | ¥1,000 - ¥3,000 |
| Cloud Run (Customer) | ¥1,000 - ¥3,000 |
| Cloud Run (Landing) | ¥500 - ¥1,000 |
| Cloud SQL (db-f1-micro) | ¥1,500 |
| Secret Manager | ¥100 |
| **合計** | **¥7,000 - ¥18,000** |

※ 使用量により変動します。本番環境ではdb-g1-small以上を推奨。
