# DB V3 Feature Verification

更新日時: 2026-03-22 JST

## Purpose

この runbook は DB remediation 完了後の feature certification 正本である。`schema / API contract unchanged` を前提に、残り 5 領域の automated proof と real LINE / Booking Link manual proof をここへ集約する。

現時点の repo 変更は次を揃える。

- route / job / service の追加 test coverage
- `scripts/smoke_public_onboarding.sh` の machine-readable artifact 出力
- `scripts/smoke_admin_capabilities.sh` による authenticated smoke
- `scripts/run_feature_verification.sh` による証跡集約
- `scripts/prepare_real_line_e2e.sh` の `dev-v3` / `live` 両対応

live 実行と manual 実連携証跡はこの runbook へ転記して確定する。repo change だけでは `verified` に昇格しない。

## Automated Verification

Canonical command:

```bash
bash scripts/run_feature_verification.sh live
```

Optional dev-v3 rehearsal:

```bash
bash scripts/run_feature_verification.sh dev-v3
```

Preflight baseline checks:

```bash
npx --prefix backend-v2 tsc --noEmit -p backend-v2/tsconfig.json
RUN_INTEGRATION=true npx --prefix backend-v2 vitest run
bash -n scripts/smoke_public_onboarding.sh scripts/smoke_admin_capabilities.sh scripts/run_feature_verification.sh scripts/prepare_real_line_e2e.sh
```

Note:

- `RUN_INTEGRATION=true npx --prefix backend-v2 vitest run` should be executed from a clean repo root. In workspaces that also contain sibling `.codex` / `.claude` worktrees, run the equivalent command from `backend-v2/` directly to avoid unrelated test discovery.

Artifact layout:

```text
scripts/out/feature_verification/<env>/<timestamp>/
  health.json
  ready.json
  public_onboarding.log
  public_onboarding.json
  admin_capabilities.log
  admin_capabilities.json
  prepare_real_line_e2e.log
  real_line_findings.<env>.md
  request-log-summary.txt
  run.log
```

Automated PASS criteria:

- `tenant/auth`, `catalog/staff`, `settings`, `analytics` smoke がすべて PASS
- request log で `uuid_hits=0`
- request log で 5xx rate `<= 2.0%`
- `admin_capabilities.json` で assignment round-trip, settings update, analytics upsert, reports/dashboard read が確認できる

## Manual Verification

Operator helper:

```bash
./scripts/prepare_real_line_e2e.sh dev-v3
./scripts/prepare_real_line_e2e.sh live
```

live smoke artifact を流す場合:

```bash
INPUT_JSON=scripts/out/feature_verification/live/<timestamp>/public_onboarding.json \
OUTPUT_PATH=scripts/out/feature_verification/live/<timestamp>/real_line_findings.live.md \
./scripts/prepare_real_line_e2e.sh live
```

Manual PASS criteria:

- `dev-v3` と `live` の両方で `root URL` と `token URL` を完走
- `LIFF init -> login -> reservation create -> my reservations -> cancel` を両経路で確認
- `live` の manual run 後に reminder send を 1 回実施
- `/api/v1/admin/reminders/logs` で `success` 行を確認
- findings sheet を本書に転記

## Evidence Log

### Automated

| Env | Timestamp | Artifact dir | Status | Notes |
| --- | --- | --- | --- | --- |
| `dev-v3` | pending | pending | pending | rehearsal optional |
| `live` | pending | pending | pending | canonical automated proof |

### Manual Real LINE

| Env | Date | Root URL | Token URL | Reminder log | Findings sheet | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `dev-v3` | pending | pending | pending | n/a | pending | pending |
| `live` | pending | pending | pending | pending | pending | pending |

## Capability Closure Checklist

| Feature | Required evidence | Repo-side proof path | Runbook close condition |
| --- | --- | --- | --- |
| Tenant / Auth foundation | `auth/config` integration + authenticated admin route smoke | `backend-v2/tests/integration/auth.routes.test.ts`, `scripts/smoke_public_onboarding.sh`, `scripts/smoke_admin_capabilities.sh` | live automated run logged here |
| Catalog / Staff | assignment admin integration + public read-path smoke | `backend-v2/tests/integration/assignment.admin.routes.test.ts`, `scripts/smoke_admin_capabilities.sh` | live automated run logged here |
| Booking Link | booking-link resolve smoke + real LINE root/token E2E | `backend-v2/tests/unit/booking-link-token.service.test.ts`, `scripts/smoke_public_onboarding.sh`, `scripts/prepare_real_line_e2e.sh` | dev-v3 + live manual findings logged here |
| Settings / Notifications | settings/reminder/service-message tests + live reminder success evidence | `backend-v2/tests/integration/settings.routes.test.ts`, `backend-v2/tests/integration/reminder.routes.test.ts`, `backend-v2/tests/unit/service-message.service.test.ts` | live reminder log entry copied here |
| Analytics / Reports / Dashboard | daily analytics job coverage + job/report/dashboard smoke | `backend-v2/tests/unit/daily-analytics-job.test.ts`, `backend-v2/tests/integration/jobs.admin.routes.test.ts`, `backend-v2/tests/integration/reports.routes.test.ts`, `backend-v2/tests/integration/dashboard.routes.test.ts`, `scripts/smoke_admin_capabilities.sh` | live automated run logged here |

## Final Closure

After the two automated/manual sections above are filled:

```bash
npx --prefix backend-v2 tsc --noEmit -p backend-v2/tsconfig.json
RUN_INTEGRATION=true npx --prefix backend-v2 vitest run
bash scripts/run_db_completeness_audit.sh live
```

Then update `docs/architecture/DB_V3_CAPABILITY_MATRIX.md`:

- 5 target rows `partial -> verified`
- `Tests / evidence` column points to this runbook
- `Remaining gap / note` is reduced to historical reference only
