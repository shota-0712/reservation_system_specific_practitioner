# GitHub Actions シークレット設定

このファイルは、GitHub Actions で設定が必要なシークレット（環境変数）の一覧です。
GitHub リポジトリ → Settings → Secrets and variables → Actions で設定してください。

---

## 必須シークレット

### GCP関連
| シークレット名 | 説明 | 例 |
|---|---|---|
| `GCP_PROJECT_ID` | Google Cloud プロジェクトID | `my-project-123456` |
| `GCP_SA_KEY` | サービスアカウントのJSONキー（全文） | `{"type": "service_account", ...}` |

### Google APIs
| シークレット名 | 説明 | 例 |
|---|---|---|
| `GOOGLE_SHEET_ID` | スプレッドシートのID | `1ABC...xyz` |
| `GOOGLE_CALENDAR_ID` | カレンダーID | `xxx@group.calendar.google.com` |
| `GOOGLE_DRIVE_FOLDER_ID` | 画像保存用フォルダID | `1ABC...xyz` |

### LINE
| シークレット名 | 説明 | 例 |
|---|---|---|
| `LINE_ACCESS_TOKEN` | LINE Messaging APIのアクセストークン | `xxx...` |
| `ADMIN_LINE_ID` | 管理者のLINE UserID（カンマ区切りで複数可） | `U7859f282793bcc5d142d78b1675d17e1,U5f0d3c6efbc2ae00fbfe05b881153f18` |
| `LIFF_ID` | LINE LIFFアプリのID | `2008591418-6eRNAepa` |

### セキュリティ
| シークレット名 | 説明 | 例 |
|---|---|---|
| `SCHEDULER_SECRET` | Cloud Schedulerからのリクエスト認証用シークレット | `your-random-secret-string` |

---

## サロン情報シークレット

### 店舗情報 (`SALON_INFO`)
LINE通知で送信される店舗情報。GitHub Secretsに以下をそのままコピペしてください：

```
【店舗情報】
サロン名: en Inner health&beauty
最寄り駅: 千葉駅・東千葉駅
住所: 〒264-0035 千葉市若葉区東寺山町581-4 VIPイーストピアビル3階
営業時間: 10:00〜19:00 (完全予約制 / 19:00以降可、ご相談ください)
定休日: 不定休
駐車場: 有り
支払い方法：現金又はクレジットカード(2万以上のみ)
```

### 注意事項 (`PRECAUTIONS`)
予約確認時に送信される注意事項。GitHub Secretsに以下をそのままコピペしてください：

```
【ご来店に際しての注意点】

⏰ 遅刻について
5分以上遅れる際は、必ずご連絡下さい。
お時間によっては、次のご予約に差し支える際は、施術の短縮・お日にち・お時間のご変更をさせていただく場合が御座います。

⚠️ キャンセルについて
無断・当日キャンセルを2回以上されますと、サロンのご利用をお控え頂く場合が御座います。

📅 サロン都合の変更について
やむを得ずお日にち・お時間をご変更させて頂く場合が御座います。
その際は、ご連絡にてご対応させて頂きます。

ご迷惑をお掛けしてしまいますが、予めご了承下さいませ。
```

### LIFF ID (`LIFF_ID`)
LINE LIFFアプリのID。GitHub Secretsに以下をそのままコピペしてください：

```
2008591418-6eRNAepa
```

---

## オプションシークレット（テーマカラー）

| シークレット名 | 説明 | デフォルト値 |
|---|---|---|
| `THEME_COLOR` | メインカラー（16進数） | `#9b1c2c` |
| `THEME_COLOR_LIGHT` | ホバー時カラー | `#b92b3d` |
| `THEME_COLOR_DARK` | アクティブ時カラー | `#7a1522` |

---

## 現在の設定値

> ⚠️ 実際のシークレット値はGitHubの設定画面でのみ確認・更新可能です。
> このファイルには機密情報を記載しないでください。

### 設定済みシークレット一覧
- [x] GCP_PROJECT_ID
- [x] GCP_SA_KEY
- [x] GOOGLE_SHEET_ID
- [x] GOOGLE_CALENDAR_ID
- [x] GOOGLE_DRIVE_FOLDER_ID
- [x] LINE_ACCESS_TOKEN
- [x] ADMIN_LINE_ID
- [x] SCHEDULER_SECRET
- [ ] LIFF_ID ← **要設定（上記の値をコピペ）**
- [ ] SALON_INFO ← **要設定（上記の値をコピペ）**
- [ ] PRECAUTIONS ← **要設定（上記の値をコピペ）**
- [ ] THEME_COLOR (オプション)
- [ ] THEME_COLOR_LIGHT (オプション)
- [ ] THEME_COLOR_DARK (オプション)
