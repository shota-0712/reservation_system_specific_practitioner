# Release Readiness Report

更新日時: 2026-03-16 JST

## 1. 判定

- **No-Go**

理由:

- Cloud SQL `reservation-system-db` が `STOPPED`
- `reserve-api` の `/ready` が `ready=false` を返却
- live DB が停止中のため、`schema_migrations` / 実テーブル状態を本番相当環境で再確認できない

## 2. 2026-03-16 時点で確認できた事実

### 2.1 ローカル品質ゲート

- `backend-v2`
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run test:ci`: pass
  - `npm run build`: pass
  - `npm audit --omit=dev`: high / critical = 0（low のみ残存）
- `admin-dashboard`
  - `npm run lint`: pass
  - `npm test`: pass
  - `npm run build`: pass
  - `npm audit --omit=dev`: 0 vulnerabilities
- `landing-page`
  - `npm run lint`: pass
  - `npm run build`: pass
  - `npm audit --omit=dev`: 0 vulnerabilities

### 2.2 Cloud Run

- `reserve-api`
  - latest ready revision: `reserve-api-00044-2bp`
  - `/health`: `200`
  - `/ready`: `ready=false`
  - readiness detail:
    - `database=false`
    - `firebase=true`
    - `googleOauthConfigured=true`
    - `writeFreezeMode=false`
- `reserve-admin`
  - latest ready revision: `reserve-admin-00035-5n2`
  - `/login`: `200`
- `reserve-customer`
  - latest ready revision: `reserve-customer-00010-4sx`
  - `/?tenant=default`: `200`
- `reserve-landing`
  - latest ready revision: `reserve-landing-00007-zdd`
  - `/`: `200`

### 2.3 Cloud SQL

- instance: `reservation-system-db`
- region: `asia-northeast1`
- engine: `POSTGRES_18`
- tier: `db-f1-micro`
- availability: `ZONAL`
- state: `STOPPED`

補足:

- `gcloud sql databases list --instance=reservation-system-db`
- `gcloud sql users list --instance=reservation-system-db`

上記 2 コマンドは「instance is not running」で失敗したため、live DB の schema 実査は未実施。

### 2.4 デプロイ導線

- `scripts/check_cloudbuild_triggers.sh`: pass
- `scripts/check_backend_deploy_iam.sh`: pass
- `scripts/check_cloud_run_security.sh`: pass（warning 3件: default compute service account）

## 3. DB 定義上の現在地

- fresh bootstrap の正本は `database/schema/001_initial_schema.sql`
- existing DB の差分適用は `database/migrations/*.sql`
- v3 hard cleanup (`20260312_v3_hard_cleanup.sql`) まで入る前提では、以下の旧互換カラムは削除済み
  - `reservations.period`
  - `reservations.date`
  - `reservations.start_time`
  - `reservations.end_time`
  - `practitioners.store_ids`
  - `menus.practitioner_ids`
  - `menu_options.applicable_menu_ids`
  - `admins.store_ids`

## 4. 追加で見つかったリスク

- `admin-dashboard` / `landing-page` は `next@15.5.10` へ更新し、production audit を解消済み
- `backend-v2` は `firebase-admin@13.7.0` と `minimatch` override で high / critical を解消済み
- `reserve-admin` / `reserve-customer` / `reserve-landing` は default compute service account を利用中
- Cloud SQL は public IPv4 有効かつ `requireSsl=false`

## 5. リリース再判定のための必須アクション

1. Cloud SQL `reservation-system-db` を起動する
2. `schema_migrations` と主要テーブルを live DB で照合する
3. `reserve-api` `/ready` が `ready=true` に戻ることを確認する
4. smoke / cutover rehearsal を再実施する
5. runtime service account / Cloud SQL ネットワーク設定の本番要件を最終確認する
