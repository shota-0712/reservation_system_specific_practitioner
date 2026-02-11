# 監視・アラート設計

**バージョン**: 2.1.0
**最終更新日**: 2026-02-09
**ステータス**: Active

---

## 1. 目的

- SLAを満たす可用性とパフォーマンスを確保
- 異常を即時に検知し、影響を最小化

---

## 2. 監視対象

### 2.1 Cloud Run
- レイテンシ
- エラーレート（5xx）
- リクエスト数
- `GET /health`（L4生存監視）
- `GET /ready`（依存関係監視: DB/Firebase/LINE）
  - `checks.writeFreezeMode` で書き込み凍結状態を確認

### 2.2 Cloud SQL
- CPU / メモリ
- 接続数
- スロークエリ
- ストレージ使用量

### 2.3 外部連携
- LINE Messaging API エラー率
- Google Calendar 同期失敗率

---

## 3. 主要アラート

| 指標 | 条件 | アクション |
|------|------|------------|
| 5xx率 | > 1%（5分） | Slack/Email通知 |
| レイテンシ | p95 > 2s | 通知 + ログ分析 |
| DB接続数 | 上限の80%超 | PgBouncer確認 |
| 予約競合エラー | 急増 | API/UX再確認 |
| Ready失敗 | `/ready` が503を返却（連続3回） | 依存先障害切り分け |

---

## 4. ログ

- Cloud Logging にJSONログ
- `tenant_id`, `store_id`, `request_id` を必ず付与
