# LINE Mini App 設定ガイド

本ドキュメントでは、LINE Mini App（LIFF）の設定と審査申請の手順を説明します。

---

## 1. LINE Developers Console 設定

### 1.1 チャネル作成

1. [LINE Developers Console](https://developers.line.biz/) にログイン
2. 「プロバイダー」を作成（会社名）
3. 「新規チャネル」→「Messaging API」を選択
4. 必要情報を入力：
   - チャネル名: サービス名（例：「リザーブ予約」）
   - チャネル説明: サービスの説明
   - 大業種・小業種: 「美容」→「美容室・ヘアサロン」
   - メールアドレス: 連絡先

### 1.2 Messaging API設定

チャネル設定ページで以下を取得・設定：

| 項目 | 説明 |
|-----|------|
| Channel ID | 環境変数 `LINE_CHANNEL_ID` に設定 |
| Channel Secret | 環境変数 `LINE_CHANNEL_SECRET` に設定 |
| Channel Access Token | 「発行」ボタンでlong-livedトークンを取得 |

### 1.3 Webhook設定

1. 「Messaging API設定」タブ
2. Webhook URL: `https://api.reserve-system.com/api/webhook/line`
3. 「Webhookの利用」をON
4. 「応答メッセージ」をOFF
5. 「あいさつメッセージ」をカスタマイズ

---

## 2. LIFF アプリ作成

### 2.1 LIFFアプリ追加

1. チャネル設定 → 「LIFF」タブ
2. 「追加」をクリック

### 2.2 LIFF設定

| 項目 | 設定値 |
|-----|-------|
| LIFFアプリ名 | 予約 |
| サイズ | Full |
| エンドポイントURL | `https://customer-app.reserve-system.com` |
| Scope | `profile`, `openid` |
| ボットリンク機能 | ON (Normal) |
| BLE機能 | OFF |

### 2.3 LIFF ID取得

作成後、LIFF ID（例：`1234567890-AbCdEfGh`）を取得し、環境変数に設定

---

## 3. LINE公式アカウント設定

### 3.1 リッチメニュー作成

1. [LINE Official Account Manager](https://manager.line.biz/) にログイン
2. 「リッチメニュー」→「作成」
3. テンプレート選択（例：大きいメニュー 6分割）

### 3.2 メニュー設定例

| 位置 | ラベル | アクション |
|-----|-------|----------|
| 左上 | 予約する | `https://liff.line.me/YOUR_LIFF_ID` |
| 右上 | 予約確認 | `https://liff.line.me/YOUR_LIFF_ID?tab=history` |
| 左下 | メニュー | `https://liff.line.me/YOUR_LIFF_ID?tab=menu` |
| 右下 | 店舗情報 | `https://example.com/shop` |

---

## 4. LINE Mini App 審査申請

### 4.1 審査前チェックリスト

#### 必須ページ

- [x] プライバシーポリシー（`/privacy`）
- [x] 利用規約（`/terms`）
- [x] 特定商取引法に基づく表記（必要な場合）

#### 機能要件

- [x] 正常に動作すること
- [x] エラー時に適切なメッセージが表示されること
- [x] 日本語で表示されること
- [x] SSL/TLS対応（HTTPS）

#### UI/UX要件

- [x] LINEのデザインガイドラインに準拠
- [x] 読み込み中の表示
- [x] タップ領域が適切なサイズ

### 4.2 申請手順

1. LINE Developers Console → チャネル設定
2. 「LIFF」タブ → 対象のLIFFアプリを選択
3. 「公開」タブ
4. 必要情報を入力：
   - サービス名
   - サービス説明
   - プライバシーポリシーURL
   - 利用規約URL
   - スクリーンショット（3枚以上）
5. 「審査を申請」をクリック

### 4.3 審査期間

- 通常: 5-10営業日
- 繁忙期: 2-3週間

### 4.4 リジェクト対応

よくあるリジェクト理由と対策：

| 理由 | 対策 |
|-----|------|
| 機能が動作しない | 全フローを再テスト |
| プライバシーポリシーがない | `/privacy` ページを確認 |
| エラーハンドリング不足 | try-catchとエラー表示を追加 |
| 日本語以外の表示 | 全テキストを確認 |

---

## 5. サービスメッセージ設定

### 5.1 Service Message API

予約確認・リマインダー送信に使用

```typescript
// サービスメッセージ送信例
POST /v2/bot/message/push
{
  "to": "USER_ID",
  "messages": [
    {
      "type": "template",
      "altText": "予約確認",
      "template": {
        "type": "buttons",
        "text": "ご予約ありがとうございます",
        "actions": [
          {
            "type": "uri",
            "label": "予約確認",
            "uri": "https://liff.line.me/YOUR_LIFF_ID?tab=history"
          }
        ]
      }
    }
  ]
}
```

### 5.2 メッセージ送信制限

| プラン | 無料メッセージ数/月 |
|-------|------------------|
| フリー | 1,000通 |
| ライト | 15,000通（+従量課金） |
| スタンダード | 45,000通（+従量課金） |

---

## 6. テスト手順

### 6.1 開発時

1. LINE Developers Console で「エンドポイントURL」をngrok等に変更
2. LIFFアプリをテスト

LIFF なしでローカル検証する場合（`customer-app/index.html`）:

```html
<script>
  window.RESERVATION_API_URL = "http://localhost:8080";
  window.RESERVATION_TENANT_KEY = "demo-salon";

  // どちらか一方を使用
  window.RESERVATION_ENABLE_MOCK = true; // 完全モック起動
  // window.RESERVATION_BYPASS_LIFF = true; // 実API + LIFFバイパス
  // window.RESERVATION_ID_TOKEN = "LINE_ID_TOKEN";
  // window.RESERVATION_PROFILE = { userId: "Uxxx", displayName: "Local User" };
</script>
```

### 6.2 本番前

1. 本番URLに変更
2. テストユーザーで全フローを確認
3. リッチメニューからの遷移確認
4. プッシュ通知の受信確認

---

## 連絡先

審査に関する問い合わせ:
- LINE Developers サポート: https://developers.line.biz/ja/support/
