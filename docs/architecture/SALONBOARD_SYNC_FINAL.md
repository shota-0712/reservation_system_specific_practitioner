# SalonBoard 連携設計書

**バージョン**: 2.2.0
**最終更新日**: 2026-03-22
**ステータス**: Active

---

## 1. 目的

- SalonBoard 連携設定の tenant-bound 正本を `tenant_salonboard_config` に置く
- 手動同期と定期同期を同じ service に集約する
- 予約取り込み時の競合と重複を DB 制約と監査ログで捕捉する

---

## 2. データストア

- `tenant_salonboard_config` に接続情報と last-sync メタデータを保存する
- `tenant_salonboard_config` は `ENABLE + FORCE ROW LEVEL SECURITY`
- `reservations.salonboard_reservation_id` は nullable unique partial index で重複排除する

---

## 3. API 契約

- `GET /api/v1/admin/integrations/salonboard`
- `PUT /api/v1/admin/integrations/salonboard`
- `POST /api/v1/admin/jobs/integrations/salonboard/sync`
- `POST /api/v1/:tenantKey/jobs/integrations/salonboard/sync`

---

## 4. 同期フロー

1. 管理画面で SalonBoard 接続設定を保存する
2. 手動ジョブまたは定期ジョブから sync service を呼び出す
3. client abstraction が外部予約一覧を返す
4. `salonboard_staff_id` と `salonboard_reservation_id` で local row を upsert する
5. 競合時はスキップして `audit_logs` に残す

---

## 5. 完了条件

- config CRUD が repository/service/route で通る
- manual/scheduler sync が mocked client で通る
- reservation upsert と conflict path が service test で通る
- audit path が config update と sync の両方で残る
- unique partial index と tenant isolation policy が schema/migration に存在する

---

## 6. 実装メモ

- real external API 連携はこの slice の完了条件に含めない
- sync service は client abstraction を介して動く
- conflict が出た予約はスキップし、必要なら手動調整する
