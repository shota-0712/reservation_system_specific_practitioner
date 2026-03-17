# プロジェクトメモ（正本）

**最終更新日**: 2026-03-12（v3 fresh-DB real LINE smoke runbook）
**更新者**: Codex

## 1. このプロジェクトでやりたいこと
- 施術者向けマルチテナント予約SaaSを、本番運用可能な品質で提供する。
- 管理画面 / 顧客アプリ / backend API / runbook を同一運用フローで管理する。

## 2. 設計の「なぜ」（Claudeはコードを読めるが理由は推測できない）

### DB: Cloud SQL + PostgreSQL RLS（行レベルセキュリティ）
- アプリ層のバグがあってもテナントデータ漏洩を防ぐため、**テナント分離をDB層で強制**した。
- JWT の `store_code` クレームを `resolve_active_store_context()` 関数でセッション変数に設定し、全クエリを自動スコープ。
- FORCE RLS（MT Wave-1 で追加）: superuser でも RLS フィルタを回避できないよう厳格化。migration 時の誤操作防止が目的。

### 認証: Firebase Auth（二重構造）
- 管理者: カスタムトークン + メール/パスワード
- 顧客: LINE OAuth2 → Firebase カスタムトークン
- `store_code` はトークンのカスタムクレームに格納。アプリが tenant を「知っている」前提ではなく、**トークンから必ず解決する**設計。

### デプロイ: Cloud Run + Cloud Build
- Revision タグでロールバックが `gcloud run services update-traffic` 一発で完了する。
- DB マイグレーション専用ユーザー `migration_user` を分離し、アプリ実行ユーザー（`app_user`）の権限を最小化。

## 3. 触らない領域（Do NOT Touch）

- **`booking-links/resolve` の token-only 経路**
  `tenantKey` ヒントなしで呼ぶと strict RLS 下で `404` になり得る既知問題。恒久対応方針が未決定（§5 ブロッカー参照）。トークン解決ロジックを変更する前に必ずテナント分離テストを実施すること。

- **RLS ポリシー（migration ファイル内）**
  変更する場合は §11.6 の T1/T2 クロステナント SQL 検証を必ず実行すること。ポリシーを緩めると全テナントのデータが漏洩する。

- **`migration_user`（DB ユーザー）**
  migration 専用ユーザー。`app_user` や他のユーザーへ変更不可。Cloud Build trigger の `_DB_USER` もこのユーザーに固定済み。

- **`resolve_active_store_context()` 関数（DB）**
  テナント解決の唯一の正規経路。この関数を経由しない `FROM stores` 直参照は廃止済み（MT-A2）。バイパスしてはいけない。

## 4. 現在の実装状況（2026-03-07 時点）

### backend-v2（Cloud SQL + RLS）
- Phase A/B + P0 + OPS-001: **完了**。
- Wave-B:
  - `CRM-BE-001`: **完了**（RFM 閾値モデル: migration + service + routes + tests）
    - `database/migrations/20260305_rfm_thresholds.sql`: `tenant_rfm_settings` テーブル + RLS
    - `database/migrations/20260305_rfm_segment_normalize.sql`: 旧セグメント値を新体系へ正規化
    - `src/services/rfm-thresholds.service.ts`: GET/upsert/validate/calcScore/calcSegment/recalculate
    - `src/routes/v1/rfm-settings.admin.routes.ts`: `GET/PUT /api/v1/admin/settings/rfm-thresholds`
    - `tests/unit/rfm-thresholds.service.test.ts`: 純粋関数・バリデーション・テナント分離
  - `CRM-BE-006`: **完了**（`tenant_notification_settings` migration + repository + type）
  - `CRM-BE-007`: **完了**（`GET/PUT /api/v1/admin/settings/notifications`）
- **MT Wave-1（DB厳格マルチテナント是正）**: **ローカル完了 / staging SQL検証ペンディング**
  - `MT-A1`: `20260311_mt_wave1_rls_hardening.sql`（FORCE RLS + resolve_active_store_context）
  - `MT-A2`: `tenant.ts` の store_code 解決を関数経由に変更（FROM stores 直参照廃止）
  - `MT-A3`: テスト 7件（Fail-fast 42883含む）
  - `MT-A4`: migration既定ユーザー `migration_user` に統一（4ファイル）
  - `MT-A5`: 管理API経路 `/api/v1/admin` をドキュメント正本化（4ファイル）
  - 残件: staging migration適用後に §11.6 SQL検証（T1/T2）を実行して `Go` 確定
- ローカル検証（2026-03-07 CRM-BE-001 gate）:
  - `npm --prefix backend-v2 run lint`: 成功
  - `npm --prefix backend-v2 run typecheck`: 成功
  - `npm --prefix backend-v2 run test:ci -- tests/unit`: 成功（**96 tests**）
  - `npm --prefix backend-v2 run build`: 成功

### admin-dashboard
- Wave-A（`CRM-FE-001`〜`004`）: **完了**。
- Wave-B:
  - `CRM-FE-005`: **完了**（通知タブ API 永続化、成功/失敗表示、テスト追加）
  - `admin-dashboard/src/lib/rfm.ts`: **完了**（`CanonicalRfmSegment` 型 + `getRfmSegmentDisplay` ヘルパー）
- ローカル検証（2026-03-07 CRM-BE-001 gate）:
  - `npm --prefix admin-dashboard run lint`: 成功
  - `npm --prefix admin-dashboard test`: 成功（**21 tests**）
  - `npm --prefix admin-dashboard run build`: 成功

### customer-app
- `APP-001`: **完了**（本番でモック経路へ自動フォールバックしない制御）
- 2026-03-12:
  - 予約 create/update payload を `startsAt` / `timezone` ベースへ移行。
  - 予約一覧の read 側も `startsAt` / `endsAt` / `timezone` 表示へ移行。

### 運用/runbook
- `QA-001`: **完了**（Wave-A 統合スモーク標準化）
- `QA-002`: **完了**（通知設定の read/write 回帰ケース + 切り分け手順を追記）
- `OPS-002`: **完了**（staging E2E のトークン運用 / preflight / postflight / 再実行条件を `DEPLOYMENT.md` に固定）
- `OPS-003`: **完了（記録作成済み）**
  - 再実施まで含む実測値（所要時間/p95/error率/rollback dry-run）を runbook へ記録
  - 最新判定: **Go（staging rehearsal）**（5xx 率 `0.00%`）
- `DOC-001`: **完了**（`DB_V3_HANDOFF_PLAN.md` を最新状態へ更新）
- `DOC-002`: **完了**（`docs/runbooks/CUTOVER_EXECUTION_PLAN.md` 作成）
  - T-1 チェックリスト / T0 タイムライン / 当日コマンド / ロールバック手順 / 記録フォーマット を固定

### v3 + Wave-1 fresh DB cycle（2026-03-12）
- Foundation:
  - export / reports / dashboard / daily analytics の reservation 参照を `date` / `start_time` / `end_time` 依存から `starts_at` / `ends_at` / `timezone` ベースへ更新。
  - `backend-v2` gate: `npm run test:ci`, `npm run build` 成功。
- UI:
  - `admin-dashboard` の staff/options で legacy compatibility field 依存をやめ、assignment API ベースへ移行。
  - `admin-dashboard` gate: `npm test`, `npm run build` 成功。
- Remote:
  - `reserve-api-dev-v3` / `reserve-customer-dev-v3` と fresh Cloud SQL は作成済みで、remote bootstrap まで確認済み。
  - seeded tenant `smoke-salon-1773288454` では owner login / claims sync / admin context / tenant LINE config 注入を確認済み。残タスクは real LINE app での LIFF 実認証 smoke。

## 5. 直近で完了したこと（セッションログ）
- 2026-03-12: dirty worktree から `codex/v3-wave1-baseline` baseline snapshot commit を作成し、Codex 専用 worktree (`codex/v3-foundation`, `codex/v3-ui`) を切り出し。
- 2026-03-12: Foundation merge を取り込み、fresh v3 schema で壊れる backend fallback SQL を `starts_at` / `timezone` ベースへ統一。
- 2026-03-12: UI merge を取り込み、customer-app の reservation 契約を `startsAt` / `timezone` へ移行し、admin-dashboard の assignment 依存を API 正本へ寄せた。
- 2026-03-12: baseline 統合後の gate を再実行し、`backend-v2` test/build と `admin-dashboard` test/build がすべて成功。
- 2026-03-12: fresh dev-v3 remote stack（Cloud SQL / `reserve-api-dev-v3` / `reserve-customer-dev-v3`）の bootstrap を確認し、seeded tenant `smoke-salon-1773288454` へ tenant mode LINE config を投入。customer root URL / booking token URL が LIFF init -> LINE Login redirect まで進むことを確認し、残タスクを real LINE app E2E に絞り込んだ。
- 2026-03-12: LIFF redirect で観測した `client_id=2008799804` に合わせて tenant `channelId` も `2008799804` へ再投入し、dev-v3 DB / `line/resolve-preview` の整合を確認した。
- 2026-03-12: `/tmp/reserve-v3-findings.md` を実機 smoke 記録テンプレートとして整備し、preflight / log watch / `auth/session 401 x2` 修復コマンドと判定基準を固定した。
- 2026-03-07: `CRM-BE-001` gate pass（backend lint/typecheck/96 tests/build + admin lint/21 tests/build）。
- 2026-03-07: `DOC-002` として `docs/runbooks/CUTOVER_EXECUTION_PLAN.md` を作成。T-1/T0 手順・ロールバック・記録フォーマットを固定。
- 2026-03-06: `CRM-BE-006/007` を実装し backend gate を通過。
- 2026-03-06: `CRM-FE-005` を実装し通知設定 API 永続化 + 単体テストを追加、admin gate を通過。
- 2026-03-06: `QA-002` を runbook に反映（通知設定 read/write 回帰手順・切り分け）。
- 2026-03-06: `OPS-002` を `docs/DEPLOYMENT.md` に反映（staging E2E 運用手順）。
- 2026-03-06: `OPS-003` rehearsal を実施し、Guardrails判定を **No-Go** と記録。
- 2026-03-06: `DOC-001` として handoff plan を更新し、次アクションを固定。
- 2026-03-06: `dashboard/activity` 5xx・tenant解決・onboarding smoke の連鎖不具合を修正し、`reserve-api-00042-99d` で smoke 完走を確認。
- 2026-03-06: `OPS-003` を再実施し、`count=31 / p95=300ms / 5xx=0` で **Go（staging rehearsal）** に更新。
- 2026-03-06: `reserve-customer-00010-4sx` へ `tenantKey` ヒント付き booking-link resolve 呼び出しを反映し、Cloud Build `customer-smoke` 成功を確認。
- 2026-03-06: MT Wave-1（DB厳格マルチテナント是正）をローカルで完了（lint/typecheck/test 94/build 全Pass）。
  - FORCE RLS、resolve_active_store_context、Fail-fast固定（42883）、migration_user統一、docs正本化。
  - staging SQL検証（T1/T2）は §11.6 コマンド確定済み・実施ペンディング。
- 2026-03-06: MU-A2 本番 trigger 更新・本番反映完了。
  - `reserve-backend` trigger: `_DB_USER=migration_user` / `_DB_PASSWORD_SECRET=db-password-migration` に更新。
  - 本番 Build ID: `de8581ef-b19c-47ad-9f19-10a4e1af5081`（SUCCESS、所要 ~3分）。
  - `/health` / `/ready` 正常確認済み。判定: **Go（20:30 JST）**。
- 2026-03-06: trigger 更新標準手順化（`TRIGGER_UPDATE_STRATEGY`）完了。
  - `create_cloudbuild_triggers.sh` に `TRIGGER_UPDATE_STRATEGY=auto|update|import` を追加（default: `auto`）。
  - `INVALID_ARGUMENT` 失敗（exit 21）を自動検出し `import` フォールバックを実行。手作業 Python 編集は不要。
  - `DEPLOYMENT.md` / `DB_V3_PHASE_B_EXECUTION_LOG.md §13` に標準手順を記載。

## 6. これからやること（優先順）
1. real LINE app で `reserve-customer-dev-v3` の root URL と booking token URL を開き、`LIFF init -> login -> reservation create -> my reservations -> cancel` を `/tmp/reserve-v3-findings.md` に記録しながら完走する。
2. post-login auth が失敗した場合は、`channelSecret` / `channelAccessToken` が LIFF app と同じ `channelId=2008799804` の値かを最優先で切り分け、`reserve-api-dev-v3` の LINE token verification ログを確認する。
3. `booking-links/resolve` の token-only 経路（tenantKey なし）の恒久対応方針を決定する。

### real LINE app smoke 手順（2026-03-12 fixpoint）

Step 0: Cloud Run ログ監視を別ターミナルで流し続ける。

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="reserve-api-dev-v3"' \
  --limit=50 \
  --format='value(timestamp,textPayload,jsonPayload.message)' \
  --freshness=5m \
  --project=keyexpress-reserve
```

Step 1: 実機前に preflight を打ち、`liffId` / `lineMode` / `lineConfigSource` と booking token resolve を確認する。

```bash
curl -s "https://reserve-api-dev-v3-czjwiprc2q-an.a.run.app/api/v1/smoke-salon-1773288454/auth/config" \
  | jq '{liffId:.data.liffId, mode:.data.lineMode, source:.data.lineConfigSource, storeId:.data.storeId}'

curl -s "https://reserve-api-dev-v3-czjwiprc2q-an.a.run.app/api/platform/v1/booking-links/resolve?token=YEJ2QHO-qMQZ4FkOO-sNKjJofKmU0R4y&tenantKey=smoke-salon-1773288454" \
  | jq '{success:.success, tenantKey:.data.tenantKey, storeId:.data.storeId, practitionerId:.data.practitionerId}'
```

Step 2: 実機テストは root URL を先に、booking token URL を後に開く。各ステップ結果は `/tmp/reserve-v3-findings.md` の表へ記録する。

- root URL: `https://reserve-customer-dev-v3-czjwiprc2q-an.a.run.app/`
- booking token URL: `https://reserve-customer-dev-v3-czjwiprc2q-an.a.run.app/?t=YEJ2QHO-qMQZ4FkOO-sNKjJofKmU0R4y`

Step 3: `auth/session 401` が 2 回続いたら、LINE Console で `channelId=2008799804` の Channel secret / Channel access token を確認後、admin token を取得して tenant LINE config を再投入する。

```bash
curl -s -X PUT \
  "https://reserve-api-dev-v3-czjwiprc2q-an.a.run.app/api/v1/admin/settings/line" \
  -H "Authorization: Bearer {ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "tenant",
    "channelId": "2008799804",
    "channelSecret": "{CHANNEL_SECRET_FROM_CONSOLE}",
    "channelAccessToken": "{LONG_LIVED_TOKEN_FROM_CONSOLE}",
    "liffId": "2008799804-XMrmdrSg"
  }'
```

判定基準:

| 現象 | 判定 | 対処 |
|------|------|------|
| 全ステップ完走 | Go | `PROJECT_MEMORY` 更新 |
| `auth/session 401` x1 のみ | 自動再試行で回復 | 続行 |
| `auth/session 401` x2 | `channelSecret` / token が別 channel | Step 3 の再投入 |
| `auth/session 404` | store / practitioner inactive | store status を確認 |
| `liff.init` 失敗 | `liffId` と LINE Console 不一致 | LINE Console で LIFF app ID を再確認 |

## 7. ブロッカー / 保留中の意思決定
- staging rehearsal 判定は **Go**（2026-03-06 JST 更新）。
- MT Wave-1: ローカル **Go**、staging SQL検証（T1/T2）ペンディング。SQL検証コマンドは §11.6 に確定済み。
- 保留事項: strict RLS 下での `booking-links/resolve` token-only 経路は `tenantKey` ヒントなしだと `404` になり得る。
- 2026-03-12 時点の fresh-DB blocker:
  - local contract/gate と fresh dev-v3 remote bootstrap は解消済み。
  - seeded tenant `smoke-salon-1773288454` の owner login / claims sync / admin context / tenant LINE config 注入、および `channelId=2008799804` への整合は確認済み。
  - 残る remote blocker は real LINE app での LIFF 実認証 E2E と、必要に応じた LINE credential same-channel 整合確認。

## 8. 毎回の更新ルール
1. 作業開始前に `docs/PROJECT_MEMORY.md` を読む。
2. 作業終了時に `4.現在の実装状況` `5.直近で完了したこと` `6.これからやること` を更新する。
3. 更新後に `npm run sync:agent-context` を実行して `CLAUDE.md` / `CODEX.md` を同期する。

## 9. 再発防止ルール

### Cloud Build trigger 更新
- `gcloud builds triggers update github --update-substitutions` が `INVALID_ARGUMENT` で失敗した場合は **手作業不要**。
- `TRIGGER_UPDATE_STRATEGY=auto`（default）で `create_cloudbuild_triggers.sh` を実行すると `describe → JSON補正 → import` が自動実行される。
- 強制 import が必要な場合は `TRIGGER_UPDATE_STRATEGY=import` を指定する。
