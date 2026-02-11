# サービスメッセージテンプレート設計

**バージョン**: 2.1.0
**最終更新日**: 2026-01-31
**ステータス**: Active

---

## 1. 目的

- 予約通知/リマインド/キャンセル連絡を統一
- 店舗ごとのブランド文言を管理

---

## 2. 保存先

- `settings.message_templates` (JSONB)
- 店舗単位でカスタマイズ可能

---

## 3. テンプレート例

```json
{
  "reservation_confirmed": "{customer}様、{date} {time} のご予約を承りました。",
  "reservation_reminder": "本日 {time} よりご予約があります。",
  "reservation_canceled": "ご予約がキャンセルされました。"
}
```

---

## 4. 送信ログ

- `audit_logs` に送信履歴を記録
- 重要通知は BigQuery 連携も検討
