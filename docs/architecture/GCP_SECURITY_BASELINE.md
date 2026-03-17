# GCP Security Baseline (Sysdig 24項目ベース)

参照: <https://www.sysdig.com/jp/learn-cloud-native/24-google-cloud-platform-gcp-security-best-practices>

このプロジェクト向けに、記事の観点を「実装済み / 次に実施」に落とし込んだ運用ベースライン。

## 1. IAM とアクセス制御

- 実装済み
  - Secret Manager 経由で機密値を注入（平文env直書きを回避）
  - Cloud Build trigger の IAM 不整合を検査（`scripts/check_backend_deploy_iam.sh`）
- 次に実施
  - Cloud Run runtime SA をサービス専用SAへ分離（default compute SA を廃止）
  - SAごとの最小権限ロールへ絞り込み（`roles/editor` を禁止）

## 2. ネットワークと公開面

- 実装済み
  - Cloud Build から Cloud Run デプロイ時に ingress を明示指定できるようにした
    - `_BACKEND_INGRESS`, `_ADMIN_INGRESS`, `_CUSTOMER_INGRESS`, `_LANDING_INGRESS`
- 次に実施
  - admin を `internal-and-cloud-load-balancing` + IAP 構成へ移行（可能な場合）
  - API の公開パスを最小化し、不要エンドポイントを閉鎖

## 3. 機密情報と暗号化

- 実装済み
  - `db-password`, `encryption-key`, `job-secret` を Secret Manager 管理
  - Secret ローテーション手順を `docs/DEPLOYMENT.md` に明文化
- 次に実施
  - CMEK（Cloud KMS）適用可否の評価
  - Secret Access 権限の監査ログ定期レビュー

## 4. ログ・監査・検知

- 実装済み
  - Cloud Build logging を `CLOUD_LOGGING_ONLY`
  - Cloud Run / Trigger 整合チェックスクリプトを運用
  - Cloud Run セキュリティ検査スクリプト追加
    - `scripts/check_cloud_run_security.sh`
- 次に実施
  - Security Command Center の有効化と通知ルール整備
  - 重要ログ（IAM変更、Secret参照、Run IAM変更）のアラート化

## 5. データ保護（Cloud SQL）

- 実装済み
  - Cloud SQL 接続は Cloud Run + Secret Manager 前提
  - migration 実行時に `BYPASSRLS` を検査して失敗させるガード
- 次に実施
  - 自動バックアップ/PITR（ポイントインタイムリカバリ）設定を必須化
  - 本番DBの削除保護・メンテナンスウィンドウ見直し

## 6. CI/CD サプライチェーン

- 実装済み
  - build/test/lint を Cloud Build quality gate で実施
  - deploy 時の Cloud Run security parameters を substitutions 化
- 次に実施
  - Artifact Registry への統一移行（`gcr.io` 依存の削減）
  - イメージ脆弱性スキャン結果をデプロイ可否に連動

## 7. すぐ実行するコマンド

```bash
PROJECT_ID=YOUR_PROJECT_ID \
CB_REGION=asia-northeast1 \
./scripts/check_cloudbuild_triggers.sh

PROJECT_ID=YOUR_PROJECT_ID \
REGION=asia-northeast1 \
STRICT_NON_DEFAULT_SERVICE_ACCOUNT=true \
./scripts/check_cloud_run_security.sh
```

上記が通る状態を、`main` へのマージ条件にする。
