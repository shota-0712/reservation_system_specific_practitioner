# Web Push 通知設計

**バージョン**: 2.1.0
**最終更新日**: 2026-01-31
**ステータス**: Draft

---

## 1. 目的

- 管理画面/スタッフ向けに重要通知を即時配信
- 将来的にWebアプリの通知体験を改善

---

## 2. 保存先（案）

- `customers.notification_token`（LINE用）
- 管理者/スタッフ向けは **専用テーブル** を推奨

```sql
CREATE TABLE web_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  admin_id UUID,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 3. 通知トリガー

- 新規予約
- キャンセル
- 当日リマインド

---

## 4. セキュリティ

- 購読情報は暗号化保存
- 送信失敗時は再購読を促す

