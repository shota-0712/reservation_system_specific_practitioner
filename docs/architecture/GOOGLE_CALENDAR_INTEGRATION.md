# Google Calendar 連携設計書

**バージョン**: 2.2.0
**最終更新日**: 2026-03-22
**ステータス**: Active

---

## 1. 目的

- 施術者の Google Calendar と予約を同期する
- 予約の可視化と二重予約防止を支える
- 連携状態とキュー状態を管理画面から監査できるようにする

---

## 2. 現行実装

- OAuth 状態は `backend-v2/src/routes/v1/google-calendar.routes.ts` の admin/callback ルートで処理する
- 連携情報は `tenant_google_calendar_oauth` に保存する
- 同期の再実行は `google_calendar_sync_tasks` の queue-backed 実装で行う
- イベントの作成・更新・削除は `backend-v2/src/services/google-calendar-sync.service.ts` から fire-and-forget で行う

---

## 3. データストア

- `tenant_google_calendar_oauth` に tenant 単位の OAuth 情報を保存する
- `practitioners.google_calendar_id` にカレンダー ID を保存する
- `google_calendar_sync_tasks` に retryable な同期タスクを保存する

---

## 4. OAuth フロー

1. 管理者が `POST /api/v1/admin/integrations/google-calendar/oauth/start` を呼ぶ
2. state に tenantId と redirectTo を埋め込んで Google OAuth 同意画面へ遷移する
3. callback で code を交換し、refresh token を暗号化して保存する
4. 成功時は redirectTo があればそこへ戻し、なければ JSON または HTML completion page を返す

---

## 5. 同期方式

- Outbound は予約作成/更新/削除時に Google Calendar API を呼ぶ
- 失敗時は `google_calendar_sync_tasks` に再試行タスクを enqueue する
- admin job route から pending/dead task を手動処理・再試行できる

---

## 6. セキュリティ

- Refresh token は AES-256-GCM で暗号化する
- `tenant_google_calendar_oauth` は tenant isolation policy と `ENABLE + FORCE ROW LEVEL SECURITY` を持つ
- `app_user` は `rolbypassrls=false` を前提に監査する

---

## 7. Proof Criteria

- admin status/save/revoke/oauth start が route test で通ること
- callback が code/state 検証と audit log side effect を持つこと
- queue-backed sync が失敗時に retry task を enqueue すること
- `tenant_google_calendar_oauth` の RLS migration が適用されていること
- live DB audit では `schema_migrations` の checksum と FORCE RLS 状態を確認すること
