<!-- AUTO-GENERATED: edit docs/PROJECT_MEMORY.md and run npm run sync:agent-context -->

# プロジェクトメモ（正本）

**最終更新日**: 2026-03-12（v3 fresh-DB foundation/UI local integration）
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
  - `reserve-api-dev-v3` / `reserve-customer-dev-v3` と fresh Cloud SQL は未作成。
  - owner register / login / claims sync / onboarding / seed / LIFF 実認証 smoke は未着手。

## 5. 直近で完了したこと（セッションログ）
- 2026-03-12: dirty worktree から `codex/v3-wave1-baseline` baseline snapshot commit を作成し、Codex 専用 worktree (`codex/v3-foundation`, `codex/v3-ui`) を切り出し。
- 2026-03-12: Foundation merge を取り込み、fresh v3 schema で壊れる backend fallback SQL を `starts_at` / `timezone` ベースへ統一。
- 2026-03-12: UI merge を取り込み、customer-app の reservation 契約を `startsAt` / `timezone` へ移行し、admin-dashboard の assignment 依存を API 正本へ寄せた。
- 2026-03-12: baseline 統合後の gate を再実行し、`backend-v2` test/build と `admin-dashboard` test/build がすべて成功。
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
1. `keyexpress-reserve` / `asia-northeast1` に fresh v3 専用の Cloud SQL instance/database/users/secrets を作成し、既存 `reservation-system-db` と完全分離する。
2. `reserve-api-dev-v3` / `reserve-customer-dev-v3` を新 DB に向けて deploy し、owner register -> login -> claims sync -> onboarding -> seed を通す。
3. admin/customer の実認証 smoke を行い、major screens と LIFF 予約 create/cancel を `/tmp/reserve-v3-findings.md` に記録しながら潰す。
4. `booking-links/resolve` の token-only 経路（tenantKey なし）の恒久対応方針を決定する。

## 7. ブロッカー / 保留中の意思決定
- staging rehearsal 判定は **Go**（2026-03-06 JST 更新）。
- MT Wave-1: ローカル **Go**、staging SQL検証（T1/T2）ペンディング。SQL検証コマンドは §11.6 に確定済み。
- 保留事項: strict RLS 下での `booking-links/resolve` token-only 経路は `tenantKey` ヒントなしだと `404` になり得る。
- 2026-03-12 時点の fresh-DB blocker:
  - local contract/gate は解消済み。
  - remote blocker は fresh Cloud SQL と `reserve-api-dev-v3` / `reserve-customer-dev-v3` の未作成、および owner/tenant/LIFF 実運用情報の未払い出し。

## 8. 毎回の更新ルール
1. 作業開始前に `docs/PROJECT_MEMORY.md` を読む。
2. 作業終了時に `4.現在の実装状況` `5.直近で完了したこと` `6.これからやること` を更新する。
3. 更新後に `npm run sync:agent-context` を実行して `CLAUDE.md` / `CODEX.md` を同期する。

## 9. 再発防止ルール

### Cloud Build trigger 更新
- `gcloud builds triggers update github --update-substitutions` が `INVALID_ARGUMENT` で失敗した場合は **手作業不要**。
- `TRIGGER_UPDATE_STRATEGY=auto`（default）で `create_cloudbuild_triggers.sh` を実行すると `describe → JSON補正 → import` が自動実行される。
- 強制 import が必要な場合は `TRIGGER_UPDATE_STRATEGY=import` を指定する。

