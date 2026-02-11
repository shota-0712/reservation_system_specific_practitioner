# Google Calendar 連携設計書

**バージョン**: 2.1.0
**最終更新日**: 2026-01-31
**ステータス**: Active

---

## 1. 目的

- 施術者のGoogleカレンダーと予約を同期
- 予約の可視化/二重予約防止

---

## 2. データストア

- `tenant_google_calendar_oauth` テーブルに OAuth 情報を保存
- `practitioners.google_calendar_id` にカレンダーIDを保存

---

## 3. OAuthフロー

1. 管理者がGoogle OAuth同意画面へ
2. refresh token を取得
3. `tenant_google_calendar_oauth` に暗号化して保存

---

## 4. 同期方式

- **Outbound**: 予約作成時に Google Calendar にイベント作成
- **Inbound**: Google Calendar のイベントを予約へ反映（任意）

---

## 5. セキュリティ

- Refresh token は暗号化（AES-256-GCM）
- Token失効時は再認証フローへ

