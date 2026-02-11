# 用語集 (Glossary)

**バージョン**: 2.1.0
**最終更新日**: 2026-01-31
**ステータス**: Active

## 目的

本ドキュメントは、予約システム全体で使用する用語を定義し、設計書間の一貫性を担保する。

---

## コアコンセプト

### テナント (Tenant)
- **定義**: 企業/グループ単位の管理主体
- **DB表現**: `tenants` テーブル
- **特徴**: すべてのデータは `tenant_id` で分離（RLS）

### 店舗 (Store)
- **定義**: 実店舗（サロン）
- **DB表現**: `stores` テーブル
- **特徴**: テナント配下で複数店舗を持てる

### テナントID (Tenant ID)
- **定義**: テナントの内部識別子
- **形式**: UUID
- **用途**: RLS / API内部の識別

### テナントSlug (Tenant Slug)
- **定義**: 管理画面URLで使用する人間可読な識別子
- **形式**: `salon-group-a`
- **用途**: 管理画面のURL、運用上の表示

### ストアID (Store ID)
- **定義**: 店舗の内部識別子
- **形式**: UUID
- **用途**: 予約/設定/集計の紐付け

### ストアコード (Store Code)
- **定義**: 顧客向けURLに使用する推測困難な識別子
- **形式**: 8〜10文字の英数字（小文字）
- **用途**: `https://reserve.example.com/{store_code}`
- **セキュリティ**: 総当たりを防止

### テナントキー (Tenant Key)
- **定義**: API URL でテナントを解決するためのキー
- **形式**: `tenant_id` / `tenant_slug` / `store_code`
- **用途**: `https://api.example.com/api/v1/{tenantKey}/...`

### RLS (Row Level Security)
- **定義**: PostgreSQLの行レベルセキュリティ
- **用途**: `tenant_id` での完全分離をDB層で強制

### 排他制約 (Exclusion Constraint)
- **定義**: PostgreSQLの排他制約
- **用途**: 同一スタッフの時間重複予約をDBレベルで防止

---

## ユーザータイプ

### 顧客 (Customer)
- **定義**: サロンの利用者
- **認証**: LINE ID Token → Firebase Custom Token
- **DB表現**: `customers` テーブル

### 施術者/スタッフ (Practitioner/Staff)
- **定義**: 施術を行うスタッフ
- **DB表現**: `practitioners` テーブル

### 管理者 (Admin)
- **定義**: 店舗/テナントの管理権限を持つユーザー
- **認証**: Firebase Auth (Email/Password)
- **DB表現**: `admins` テーブル

---

## 予約関連

### 予約 (Reservation)
- **定義**: 顧客による施術の予約
- **ステータス**: `pending`, `confirmed`, `completed`, `canceled`, `no_show`
- **DB表現**: `reservations` テーブル

### 空き枠 (Available Slot)
- **定義**: 予約可能な時間帯
- **計算**: 営業時間 - 既存予約 - 休憩/ブロック時間
- **粒度**: 15〜30分

---

## メニュー/カルテ

### メニュー (Menu)
- **定義**: 施術メニュー
- **DB表現**: `menus` テーブル

### オプション (Option)
- **定義**: 追加可能なサービス
- **DB表現**: `menu_options` テーブル

### カルテ (Karte)
- **定義**: 施術記録
- **DB表現**: `kartes` テーブル

---

## 分析/監査

### 日次集計 (Daily Analytics)
- **定義**: 日次売上・予約数などの集計
- **DB表現**: `daily_analytics` テーブル

### 監査ログ (Audit Log)
- **定義**: 重要操作の履歴
- **DB表現**: `audit_logs` テーブル
