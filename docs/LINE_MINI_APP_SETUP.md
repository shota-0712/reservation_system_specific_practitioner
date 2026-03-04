# LINEミニアプリ 開発開始ガイド

本ドキュメントは、このリポジトリで LINE ミニアプリ開発を始める前に確認すべき事項と、最初のセットアップ手順をまとめたものです。

---

## 0. 開発開始前に必ず読む

以下を最初に確認すること。

- 仕様
  - https://developers.line.biz/ja/docs/line-mini-app/discover/specifications/
- デザイン
  - https://developers.line.biz/ja/docs/line-mini-app/design/line-mini-app-icon/
  - https://developers.line.biz/ja/docs/line-mini-app/design/landscape/
  - https://developers.line.biz/ja/docs/line-mini-app/design/loading-icon/
- 開発
  - https://developers.line.biz/ja/docs/line-mini-app/develop/performance-guidelines/
- 申請・ポリシー
  - https://developers.line.biz/ja/docs/line-mini-app/submit/submission-guide/
  - https://terms2.line.me/LINE_MINI_App?lang=ja

---

## 1. LINEミニアプリチャネル作成

> 以前の Messaging API チャネル前提ではなく、LINEミニアプリチャネルを作成すること。

1. https://developers.line.biz/console/ にアクセス
2. 対象プロバイダーを選択
3. `チャネル設定 > 新規チャネル作成 > LINEミニアプリ` を選択
4. 必須項目を入力して作成

### 1.1 主な必須入力項目

- チャネルの種類: `LINEミニアプリ`
- プロバイダー: 手順2で選択したもの
- サービスを提供する地域: 日本 / タイ / 台湾
- チャネル名
- チャネル説明
- メールアドレス
- プライバシーポリシーURL（認証プロバイダーは作成時に必須）
- LINE開発者契約 / LINEミニアプリプラットフォーム規約 / LINEミニアプリポリシーへの同意
- サービス事業主の所在国・地域に関する表明

### 1.2 重要な注意点

- チャネルは後から別プロバイダーへ移動できない。
- ユーザーIDはプロバイダー単位で異なるため、プロバイダー設計は初期に確定する。
- 提供地域がタイ/台湾の場合は、作成権限に追加制約がある。
- 開発担当企業とサービス事業主が異なる場合、チャネル説明とプライバシーポリシーURLの整備が審査上ほぼ必須。

---

## 2. LINEミニアプリの内部チャネルを理解する

LINE Developersコンソール上は1つのミニアプリチャネルでも、内部的には以下の3チャネルで運用される。

- 開発用（開発中）
- 審査用（開発中）
- 本番用（公開中）

設定反映タイミングや公開フローは以下を参照する。
- https://developers.line.biz/ja/docs/line-mini-app/discover/console-guide/

---

## 3. ウェブアプリ設定とエンドポイント

`ウェブアプリ設定` で、開発用/審査用/本番用のエンドポイントURLを管理する。

- 開発用: 検証環境URL
- 審査用: 審査時に実際に確認されるURL
- 本番用: 公開URL

### 3.1 公開前アクセス制限（ベーシック認証）

- ステータスが `審査前` または `審査中` のミニアプリで利用可能
- LIFFブラウザで開いた場合のみ有効
- 公開後や LIFF間遷移後は想定どおり動かないケースがあるため、簡易保護として扱う

---

## 4. 実装時チェックリスト（このプロジェクト向け）

### 4.1 UI/UX・デザイン

- アイコン仕様に準拠している
- ランドスケープ時のセーフエリア崩れがない
- 読み込み中アイコン/ローディング表示を実装済み

### 4.2 パフォーマンス

- 初期表示で不要な API 呼び出しを避ける
- 画像/JS のサイズを抑える
- 主要導線（予約開始〜完了）で体感遅延を抑える

### 4.3 本リポジトリ固有

- `customer-app/index.html` の LIFF 初期化に必要な `liffId` をテナント設定へ登録
- `backend-v2` で LINE 関連 Secret（`LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN`）を設定
- テナントごとの LINE 設定値（`lineConfig`）が API で解決できることを確認

---

## 5. 審査前チェック

### 5.1 必須情報

- プライバシーポリシーURL
- 利用規約URL（任意だが設定推奨）
- 企業情報・責任主体の説明

### 5.2 動作確認

- 主要導線が正常動作する
- エラー時にユーザー向けメッセージが表示される
- 日本語表示が統一されている
- HTTPS でのみ提供している

### 5.3 申請

審査申請手順:
- https://developers.line.biz/ja/docs/line-mini-app/submit/submission-guide/

---

## 6. ローカル検証メモ（LIFFなし）

`customer-app/index.html` では以下の設定でローカル検証可能。

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

---

## 7. 参考リンク

- LINE Developers Console 概要:
  - https://developers.line.biz/ja/docs/line-developers-console/overview/
- プロバイダーとチャネル管理ベストプラクティス:
  - https://developers.line.biz/ja/docs/line-developers-console/best-practices-for-provider-and-channel-management/
- LINEミニアプリ用 API リファレンス:
  - https://developers.line.biz/ja/reference/line-mini-app/
