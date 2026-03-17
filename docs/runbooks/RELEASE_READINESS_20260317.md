# Release Readiness Report

更新日時: 2026-03-17 JST

## 1. 判定

- **No-Go**

理由:

- Cloud SQL 起動後は `/ready` が `true` に戻ったが、public onboarding smoke が `GET /api/v1/{tenantKey}/auth/config` で `500` を返す
- live DB は `20260311_mt_wave1_rls_hardening.sql` までで止まっており、`20260312_v3_hard_cleanup.sql` は未適用

## 2. 2026-03-17 に確認した事実

### 2.1 Cloud SQL / readiness

- 実行コマンド:
  - `PROJECT_ID=keyexpress-reserve ./scripts/rightsize_cloud_sql.sh --start --apply`
- 確認結果:
  - Cloud SQL `reservation-system-db`: `RUNNABLE`
  - `reserve-api /ready`: `ready=true`

補足:

- `rightsize_cloud_sql.sh` 自体は Cloud SQL operation wait timeout で非0終了したが、その後の `gcloud sql instances describe` では `RUNNABLE` を確認

### 2.2 live DB 実査

- 接続:
  - `migration_user` + Cloud SQL Proxy で接続成功
- `schema_migrations` 最新:
  - `20260311_mt_wave1_rls_hardening.sql`
- 未適用:
  - `20260312_v3_hard_cleanup.sql`
- 旧互換カラム:
  - `admins.store_ids`
  - `menu_options.applicable_menu_ids`
  - `menus.practitioner_ids`
  - `practitioners.store_ids`
  - `reservations.date`
  - `reservations.end_time`
  - `reservations.period`
  - `reservations.start_time`
- 関数:
  - `resolve_active_store_context`
  - `resolve_booking_link_token`
- RLS:
  - `booking_link_tokens`, `export_jobs`, `tenant_notification_settings`, `tenant_rfm_settings` は `FORCE ROW LEVEL SECURITY`
- `app_user`:
  - `rolbypassrls = false`

### 2.3 smoke 再実施

- 実行コマンド:
  - `API_URL=https://reserve-api-czjwiprc2q-an.a.run.app FIREBASE_API_KEY=<configured> RUN_RESERVATION_TEST=true ./scripts/smoke_public_onboarding.sh`
- 結果:
  - `registration-config`: pass
  - Firebase signup: pass
  - `onboarding/register`: pass
  - `GET /api/v1/smoke-salon-1773680978/auth/config`: **500**

### 2.4 Cloud Run log 根拠

- service: `reserve-api`
- revision: `reserve-api-00044-2bp`
- path: `/api/v1/smoke-salon-1773680978/auth/config`
- error:
  - `invalid input syntax for type uuid: ""`
  - stack trace 上は tenant resolution (`middleware/tenant`) の store lookup 経路で発生

## 3. repo 側で入れた修正

- `backend-v2/src/middleware/tenant.ts`
  - `tenantKey` が `store_code` 形式 (`^[a-z0-9]{8,10}$`) のときだけ `resolve_active_store_context()` を呼ぶよう変更
  - slug 形式のキーは直接 slug lookup に進む
- `backend-v2/tests/unit/tenant.middleware.test.ts`
  - 上記仕様に合わせてテスト更新

検証:

- `npm --prefix backend-v2 run test:ci -- tests/unit/tenant.middleware.test.ts tests/unit/v1-router.test.ts tests/unit/auth.middleware.test.ts`: pass
- `npm --prefix backend-v2 run build`: pass

## 4. 次に必要なこと

1. backend の新 revision を deploy する
2. `auth/config` を含む public onboarding smoke を再実施する
3. `20260312_v3_hard_cleanup.sql` を live DB に適用するか判断し、適用するなら precheck 付きで実施する
4. 再度 Go / No-Go を更新する
