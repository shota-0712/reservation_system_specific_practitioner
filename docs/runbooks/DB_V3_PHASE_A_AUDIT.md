# DB V3 Phase A 差分監査結果（SQL vs API）

更新日時: 2026-03-05 JST  
対象: `database/migrations/20260306_v3_core_normalization_and_exports.sql` / `20260307_export_jobs_gcs_storage.sql` と `backend-v2/src/**`

## 1. 監査チェック結果

- 予約時間の正本（`starts_at/ends_at/timezone`）
  - 判定: **修正済み**
  - 内容: `reservation.repository` の作成/更新処理を `starts_at/ends_at` 更新に合わせた。
- 予約重複時の 409 マッピング（`23P01`）
  - 判定: **適合**
  - 内容: `error-handler` で `23P01` を `ConflictError(409)` に変換。
- 予約ステータス遷移ルール（DB トリガー）
  - 判定: **適合**
  - 内容: DB 側 `enforce_reservation_status_transition` が最終ガード。API 側からの不正遷移は DB 制約で拒否。
- assignment 正規化（旧配列カラム依存の移行）
  - 判定: **適合**
  - 内容: `menu/practitioner/option` repository は assignment テーブル参照を主にし、旧配列は互換フォールバック。
- export_jobs（GCS 拡張含む）
  - 判定: **適合**
  - 内容: API/service は `storage_type='inline'|'gcs'` / `gcs_*` / 署名URL有効期限を処理。

## 2. Issue リスト

### must-fix

1. **MF-01: 予約更新時の日時反映不整合（V3正本との差分）**  
   - 影響: `sync_reservation_time_fields` 導入後、API 側が `starts_at/ends_at` を更新しないと日時変更が反映されない可能性。  
   - 対応: **修正済み**  
   - 修正ファイル:
     - `backend-v2/src/repositories/reservation.repository.ts`
   - 修正内容:
     - `create` で `starts_at/ends_at` を明示設定
     - `updateWithItems` で `starts_at/ends_at` を明示更新
     - `update`（部分更新）でも日時3点指定時に `starts_at/ends_at` 更新
     - `hasConflict` を `tstzrange(starts_at, ends_at, '[)')` ベースに寄せた

2. **MF-02: onboarding/register が RLS で 500（uuid キャスト）**  
   - 影響: `admins` 事前照会時に tenant context 未設定だと `current_setting('app.current_tenant', true)::uuid` が `invalid input syntax for type uuid: ""` で失敗し、新規登録が 500 になる。  
   - 対応: **修正済み**  
   - 修正ファイル:
     - `backend-v2/src/services/onboarding.service.ts`
     - `backend-v2/tests/unit/onboarding.service.test.ts`
   - 修正内容:
     - `admins` 事前照会を削除し、`admins.firebase_uid UNIQUE`（DB制約）違反 `23505` を競合として扱う方式に変更
     - 単体テストを `INSERT ... ON CONFLICT` ベースの現行実装に追従

### nice-to-have

1. **NT-01: 予約ステータス遷移違反（`23514`）のエラーメッセージ粒度**  
   - 現状: `23514` は汎用バリデーションメッセージに集約。  
   - 提案: `constraint/message` を見て「無効なステータス遷移」を明示するドメインエラーに寄せる。

## 3. Phase A 判定

- must-fix: **0（解消済み）**
- Phase B 進行可否: **進行可能**
