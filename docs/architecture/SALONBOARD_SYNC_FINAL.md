# SalonBoard 連携設計書

**バージョン**: 2.1.0
**最終更新日**: 2026-01-31
**ステータス**: Active

---

## 1. 目的

- SalonBoard との予約同期を実現
- ダブルブッキングを防止

---

## 2. データストア

- `tenant_salonboard_config` テーブルに認証情報を保存（暗号化）
- `reservations.salonboard_reservation_id` で紐付け

---

## 3. 同期フロー

1. 管理画面で連携設定（ID/PW）
2. 定期ジョブで SalonBoard API をポーリング
3. 新規予約を `reservations` に取り込み
4. 更新差分を同期

---

## 4. 排他制約との連携

- 同期時も `reservations` の排他制約が適用される
- 競合時は `audit_logs` に記録し、再試行/手動調整

