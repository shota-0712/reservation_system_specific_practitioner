# マルチテナント予約システム SaaS

施術者向けのマルチテナント予約システムです。  
この README は「今どこを触るべきか」「どこに何があるか」を最短で掴むための入口です。

## 迷ったときの入口

1. 実装の起点: `backend-v2/` `admin-dashboard/` `customer-app/`
2. ドキュメント案内: `docs/README.md`
3. 仕様の正本: `docs/architecture/` と `docs/runbooks/`
4. バックエンド実装の参照文献: `docs/backend-development/`

## リポジトリ構成（現在）

```text
reservation_system_practitioner/
├── backend-v2/               # 正式バックエンド API（TypeScript + Express + PostgreSQL）
├── admin-dashboard/          # 管理画面（Next.js + shadcn/ui）
├── customer-app/             # 顧客向けLINEミニアプリ（静的アプリ）
├── landing-page/             # LP（Next.js）
├── database/                 # schema / migrations / seeds
├── scripts/                  # 運用スクリプト（Cloud Build, cutover/rollback, smoke test など）
├── docs/
│   ├── architecture/         # 設計資料（仕様の正本）
│   ├── runbooks/             # 運用手順・実行ログ
│   └── backend-development/  # バックエンド実装時の参照文献
├── cloudbuild.yaml           # 全サービス統合 Cloud Build
├── CLAUDE.md                 # AIコンテキスト同期先
└── CODEX.md                  # AIコンテキスト同期先
```

## クイックスタート

### 前提

- Node.js / npm
- PostgreSQL（Cloud SQL 接続時は必要に応じて `cloud_sql_proxy`）

### バックエンド（backend-v2）

```bash
cd backend-v2
npm install
npm run dev
# http://localhost:8080
```

### 管理画面（admin-dashboard）

```bash
cd admin-dashboard
npm install
npm run dev
# http://localhost:3000
```

### 顧客向けアプリ（customer-app）

```bash
cd customer-app
# 静的HTMLアプリ
# ローカル検証の詳細は docs/LINE_MINI_APP_SETUP.md を参照
```

## バックエンド実装時の参照文献

- 参照入口: `docs/backend-development/README.md`
- 主な用途:
  - API設計: `01-rest-api-principles.md` `02-endpoint-design.md`
  - 認証/認可: `03-authentication-authorization.md` `11-backend-security.md`
  - DB変更: `07-schema-design.md` `09-migration-management.md` `10-schema-evolution.md`
  - 障害/例外: `12-error-handling.md`

## プロジェクト洗浄（クリーンアップ）

生成物やローカル専用ファイルを掃除できます。

```bash
# 候補を確認（削除はしない）
npm run clean:dry-run

# 生成物を削除
npm run clean:workspace

# 生成物 + ローカルツールバイナリ（cloud_sql_proxy）を削除
npm run clean:workspace:all
```

対象例:

- `node_modules`（root / 各アプリ）
- `.next`（Next.jsビルド生成物）
- `backend-v2/dist` / `coverage`
- `.DS_Store`
- `cloud_sql_proxy`（`clean:workspace:all` のみ）

## デプロイ・運用

- 統合デプロイ設定: `cloudbuild.yaml`
- デプロイ/切替/切戻し手順: `docs/DEPLOYMENT.md`
- Trigger作成: `scripts/create_cloudbuild_triggers.sh`
- 切替コマンド生成: `scripts/generate_cutover_commands.sh`
- 切戻し: `scripts/rollback_cutover.sh`
- 旧backend廃止: `scripts/decommission_old_backend.sh`

## AI運用メモ

- 正本: `docs/PROJECT_MEMORY.md`
- 同期先: `CLAUDE.md` / `CODEX.md`
- 更新手順:
  1. 作業終了時に `docs/PROJECT_MEMORY.md` を更新
  2. `npm run sync:agent-context` を実行
