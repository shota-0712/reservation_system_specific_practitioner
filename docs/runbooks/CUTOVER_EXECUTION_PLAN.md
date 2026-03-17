# 本番 Cutover 最終実行計画（平日夜 20:00 JST / 2時間）

**作成日**: 2026-03-07
**対象ブランチ**: main（MU-A2 反映済み）
**実施条件**: staging rehearsal Go 確認済み（2026-03-06）

---

## Summary

MU-A2 完了後の本番切替を、WRITE_FREEZE → backend deploy（integration + migration）→ smoke → unfreeze → legacy 停止まで同一ウィンドウで実施する。
実行経路は `gcloud builds triggers run reserve-backend` を基準に固定し、ローカル作業ツリー依存を排除する。

---

## 体制（固定）

| 役割 | 担当範囲 | Go/No-Go 権限 |
|---|---|---|
| Commander | 全体進行・判定記録 | 最終判定 |
| Deploy Operator | trigger 実行・Cloud Run/Scheduler 操作 | なし |
| Validator | health/ready/smoke/log 確認 | No-Go 提案 |
| Scribe | runbook・PROJECT_MEMORY 更新 | なし |

---

## T-1（前日）チェックリスト

```bash
# 1. IAM チェック
./scripts/check_backend_deploy_iam.sh

# 2. Cloud Build trigger チェック
./scripts/check_cloudbuild_triggers.sh

# 3. Cloud Run セキュリティチェック
./scripts/check_cloud_run_security.sh
```

Go 条件: すべて Pass（警告のみ可）

```bash
# 4. Cutover コマンドシート再生成（MU-A2 値で再固定）
PROJECT_ID=keyexpress-reserve \
  NEXT_PUBLIC_API_URL=<API_URL> \
  NEXT_PUBLIC_ADMIN_URL=<ADMIN_URL> \
  NEXT_PUBLIC_FIREBASE_API_KEY=<KEY> \
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<DOMAIN> \
  NEXT_PUBLIC_FIREBASE_PROJECT_ID=keyexpress-reserve \
  NEXT_PUBLIC_TENANT_ID=<TENANT_ID> \
  CLOUDSQL_CONNECTION=<CONNECTION> \
  CLOUDSQL_INSTANCE=<INSTANCE> \
  DB_USER=migration_user \
  DB_PASSWORD_SECRET=db-password-migration \
  ./scripts/generate_cutover_commands.sh
```

Go 条件: `docs/runbooks/CUTOVER_COMMANDS.generated.md` の `_DB_USER=migration_user` / `_DB_PASSWORD_SECRET=db-password-migration` が一致すること。

```bash
# 5. 直前安定 revision 採取（3 サービス）
for svc in reserve-api reserve-admin reserve-customer; do
  echo "${svc}: $(gcloud run services describe ${svc} \
    --project keyexpress-reserve --region asia-northeast1 \
    --format='value(status.latestReadyRevisionName)')"
done
```

Go 条件: 3 サービスすべて revision 名が取得できること。取得値を手元にメモする。

---

## T0 タイムライン（当日 20:00–22:00 JST）

| Step | 時刻 | 内容 | Go 条件 | No-Go 条件 |
|---|---|---|---|---|
| 4 | 20:00-20:15 | Preflight | /health healthy, /ready ready=true, IAM/trigger/security Pass | いずれか失敗 |
| 5 | 20:15-20:25 | Freeze + Scheduler Pause | API revision 更新済み、4 ジョブ paused | pause 失敗 |
| 6 | 20:25-21:00 | Backend trigger 実行 | build status SUCCESS | build 失敗 |
| 7 | 21:00-21:20 | Post-deploy 検証 | ready 維持、smoke 完走、重大エラーなし | smoke 失敗/ready 不成立/5xx 連続 |
| 8 | 21:20-21:30 | Unfreeze + Scheduler Resume | ready=true 維持、scheduler 全 enabled | いずれか失敗 |
| 9 | 21:30-21:45 | Legacy backend 停止 | legacy サービス停止完了 | 本体は維持、legacy 停止のみ翌営業日 |
| 10 | 21:45-22:00 | 記録更新・クローズ | Commander Go 確定 | — |

---

## 実行コマンド（当日用）

### 環境変数（当日冒頭で export）

```bash
export PROJECT_ID=keyexpress-reserve
export REGION=asia-northeast1
export CB_REGION=asia-northeast1
export BACKEND_TRIGGER_NAME=reserve-backend
export API_SERVICE=reserve-api
export ADMIN_SERVICE=reserve-admin
export CUSTOMER_SERVICE=reserve-customer
export JOB_LOCATION=asia-northeast1
```

### Step 4: Preflight

```bash
# health / ready
curl -sS "$(gcloud run services describe ${API_SERVICE} \
  --project ${PROJECT_ID} --region ${REGION} \
  --format='value(status.url)')/health"
curl -sS "$(gcloud run services describe ${API_SERVICE} \
  --project ${PROJECT_ID} --region ${REGION} \
  --format='value(status.url)')/ready"

# IAM / trigger / security
./scripts/check_backend_deploy_iam.sh
./scripts/check_cloudbuild_triggers.sh
./scripts/check_cloud_run_security.sh
```

### Step 5: Freeze + Scheduler Pause

```bash
gcloud run services update "${API_SERVICE}" \
  --project "${PROJECT_ID}" --region "${REGION}" \
  --update-env-vars=WRITE_FREEZE_MODE=true

for j in reminder-day-before reminder-same-day daily-analytics google-calendar-sync; do
  gcloud scheduler jobs pause "${j}" \
    --project "${PROJECT_ID}" --location "${JOB_LOCATION}"
done
```

### Step 6: Backend trigger 実行

```bash
RUN_JSON=$(gcloud builds triggers run "${BACKEND_TRIGGER_NAME}" \
  --project "${PROJECT_ID}" --region "${CB_REGION}" --branch=main \
  --substitutions=_RUN_INTEGRATION=true,_RUN_MIGRATIONS=true,_WRITE_FREEZE_MODE=true,_DB_USER=migration_user,_DB_PASSWORD_SECRET=db-password-migration \
  --format=json)
BUILD_ID=$(jq -r '.metadata.build.id' <<<"${RUN_JSON}")
echo "Build ID: ${BUILD_ID}"

# ビルドログをストリーミング確認
gcloud builds log "${BUILD_ID}" \
  --project "${PROJECT_ID}" --region "${CB_REGION}" --stream
```

Go 条件: `Build finished with SUCCESS` がログに出力されること。

### Step 7: Post-deploy 検証

```bash
# health / ready
curl -sS "$(gcloud run services describe ${API_SERVICE} \
  --project ${PROJECT_ID} --region ${REGION} \
  --format='value(status.url)')/health"
curl -sS "$(gcloud run services describe ${API_SERVICE} \
  --project ${PROJECT_ID} --region ${REGION} \
  --format='value(status.url)')/ready"

# smoke（予約テスト含む）
RUN_RESERVATION_TEST=true ./scripts/smoke_public_onboarding.sh
```

### Step 8: Unfreeze + Scheduler Resume

```bash
gcloud run services update "${API_SERVICE}" \
  --project "${PROJECT_ID}" --region "${REGION}" \
  --update-env-vars=WRITE_FREEZE_MODE=false

for j in reminder-day-before reminder-same-day daily-analytics google-calendar-sync; do
  gcloud scheduler jobs resume "${j}" \
    --project "${PROJECT_ID}" --location "${JOB_LOCATION}"
done
```

### Step 9: Legacy backend 停止

```bash
# dry-run で確認してから apply
PROJECT_ID=${PROJECT_ID} REGION=${REGION} OLD_BACKEND_SERVICE=reserve-api-legacy \
  ./scripts/decommission_old_backend.sh

# 問題なければ apply
PROJECT_ID=${PROJECT_ID} REGION=${REGION} OLD_BACKEND_SERVICE=reserve-api-legacy \
  ./scripts/decommission_old_backend.sh --apply
```

> **注意**: `decommission_old_backend.sh` は `OLD_BACKEND_SERVICE` 環境変数が必須。
> ドメイン・シークレット・SA を合わせて削除する場合は `OLD_BACKEND_DOMAINS` / `OLD_BACKEND_SECRET_NAMES` / `OLD_BACKEND_SERVICE_ACCOUNT` も設定する。
> Step 9 失敗時は「本体（reserve-api/admin/customer）は Go 維持」、legacy 停止のみ翌営業日に再実施する。

---

## ロールバック手順（No-Go 時）

```bash
# dry-run 確認
PROJECT_ID=${PROJECT_ID} REGION=${REGION} \
  API_SERVICE=${API_SERVICE} ADMIN_SERVICE=${ADMIN_SERVICE} CUSTOMER_SERVICE=${CUSTOMER_SERVICE} \
  JOB_LOCATION=${JOB_LOCATION} \
  JOB_NAMES=reminder-day-before,reminder-same-day,daily-analytics,google-calendar-sync \
  ./scripts/rollback_cutover.sh --resume-jobs

# 実行
PROJECT_ID=${PROJECT_ID} REGION=${REGION} \
  API_SERVICE=${API_SERVICE} ADMIN_SERVICE=${ADMIN_SERVICE} CUSTOMER_SERVICE=${CUSTOMER_SERVICE} \
  JOB_LOCATION=${JOB_LOCATION} \
  JOB_NAMES=reminder-day-before,reminder-same-day,daily-analytics,google-calendar-sync \
  ./scripts/rollback_cutover.sh --apply --resume-jobs
```

> **注意**: `rollback_cutover.sh` は直前の revision を自動検出する。T-1 で採取した `STABLE_*_REVISION` を明示する場合は環境変数で渡す。
> `reserve-api` が freeze のままなら `WRITE_FREEZE_MODE=false` を別途設定する。
> runbook に No-Go 理由と再実施条件を記録し、同一ウィンドウでの再試行はしない。

---

## 記録フォーマット（Step 10 で記入）

| 項目 | 値 |
|---|---|
| 実施日時 | YYYY-MM-DD HH:MM JST |
| Build ID | （Step 6 で取得した値） |
| /health | healthy / unhealthy |
| /ready | ready=true / false |
| smoke | pass / fail |
| 5xx 率 | x.xx% |
| freeze → unfreeze | 完了 / 未完了 |
| legacy 停止 | 完了 / 未完了 / 翌営業日 |
| 最終判定 | Go / No-Go |
| Commander | （名前） |

---

## Acceptance Criteria

1. backend build が `SUCCESS`（integration + migration 有効）。
2. `/health` healthy、`/ready` ready=true を維持。
3. freeze → unfreeze、pause → resume が全ジョブで完了。
4. legacy 停止が完了（同一ウィンドウ方針）。
5. runbook と PROJECT_MEMORY に実測値・判定・Build ID が反映済み。

---

## 参照ドキュメント

- [DEPLOYMENT.md](../DEPLOYMENT.md) — staging E2E 運用手順・OPS-002
- [DB_V3_HANDOFF_PLAN.md](DB_V3_HANDOFF_PLAN.md) — DB 切替ハンドオフ計画
- [DB_V3_PHASE_B_EXECUTION_LOG.md](DB_V3_PHASE_B_EXECUTION_LOG.md) — Phase B 実行ログ（§13: trigger 更新標準手順）
- [docs/PROJECT_MEMORY.md](../PROJECT_MEMORY.md) — プロジェクト正本メモ
