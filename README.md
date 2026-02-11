# マルチテナント予約システム SaaS

施術者向けのマルチテナント予約システムです。

## プロジェクト構造

```
reservation_system_practitioner/
├── backend-v2/          # 正式バックエンド API（TypeScript + Express + PostgreSQL）
├── admin-dashboard/     # 管理画面（Next.js + shadcn/ui）
├── customer-app/        # 顧客向けLINEミニアプリ（静的アプリ）
├── landing-page/        # LP（Next.js）
├── database/            # schema / migrations / seeds
├── scripts/             # 運用スクリプト（trigger作成、cutover/rollback補助）
├── cloudbuild.yaml      # 全サービス統合 Cloud Build
└── docs/                # 運用・アーキテクチャドキュメント
```

## クイックスタート

### バックエンド（backend-v2）
```bash
cd backend-v2
npm install
npm run dev
# → http://localhost:8080
```

### 管理画面（Admin Dashboard）
```bash
cd admin-dashboard
npm install
npm run dev
# → http://localhost:3000
```

### 顧客向けアプリ（LINE Mini App）
```bash
cd customer-app
# 静的HTMLアプリ（Cloud Runでは nginx コンテナ配信）
# ローカル検証は docs/LINE_MINI_APP_SETUP.md を参照
```

## 機能一覧

### 管理画面
- ダッシュボード（KPI表示）
- 予約カレンダー
- 顧客管理
- メニュー管理
- スタッフ管理
- レポート
- 設定（店舗情報、営業時間、通知、予約設定、連携）

### 顧客向けアプリ（LINEミニアプリ）
- メニュー選択
- オプション選択
- 施術者選択
- 日時選択
- 予約確認・完了
- 予約履歴・キャンセル

## 技術スタック

| コンポーネント | 技術 |
|--------------|------|
| 管理画面 | Next.js 14, shadcn/ui, Tailwind CSS |
| 顧客向けアプリ | Vanilla HTML/JS, LIFF SDK, Tailwind CSS |
| バックエンド | TypeScript, Express.js, Node.js |
| データベース | Cloud SQL (PostgreSQL) |
| 認証 | LINE LIFF, Firebase Auth |

## デプロイ

- 統合デプロイ設定: `cloudbuild.yaml`
- デプロイ/切替/切戻し手順: `docs/DEPLOYMENT.md`
- Trigger作成スクリプト: `scripts/create_cloudbuild_triggers.sh`
- 切替コマンド生成スクリプト: `scripts/generate_cutover_commands.sh`
- 切戻しスクリプト: `scripts/rollback_cutover.sh`
- 旧backend廃止スクリプト: `scripts/decommission_old_backend.sh`

## 補足

- 旧 `backend/` は廃止しました（必要なら Git 履歴から参照可能）。新規開発と本番運用は `backend-v2/` を前提にします。
