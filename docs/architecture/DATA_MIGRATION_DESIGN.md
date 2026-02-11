# データ移行設計書（PostgreSQL）

**バージョン**: 2.1.0
**最終更新日**: 2026-01-31
**ステータス**: Draft

---

## 1. 目的

既存データストア（Google Sheets / 旧DB など）から
Cloud SQL (PostgreSQL) への移行手順を定義する。

---

## 2. 移行対象

| 種別 | 移行元 | 移行先 |
|------|--------|--------|
| テナント/店舗 | Sheets/旧DB | `tenants`, `stores` |
| 予約 | Sheets/旧DB | `reservations`, `reservation_menus`, `reservation_options` |
| 顧客 | Sheets/旧DB | `customers` |
| メニュー/スタッフ | Sheets/旧DB | `menus`, `practitioners` |

---

## 3. 移行ステップ

1. **スキーマ適用**（Cloud SQL）
2. **データ抽出**（CSV/JSON）
3. **変換/正規化**
4. **一括投入**（COPY / バッチINSERT）
5. **整合性チェック**（件数・サンプル検証）
6. **並行運用テスト**
7. **本番切替**

---

## 4. 注意点

- `tenant_id`/`store_id` の整合
- 予約の重複は **排他制約** で防止
- 顧客の LINE ID は一意に保持

---

## 5. 検証項目

- 件数一致
- 予約の期間（period）の正しさ
- 顧客/予約/スタッフのリレーション整合
