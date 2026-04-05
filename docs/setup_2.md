# Google Tasks + Calendar セットアップ手順

1. Google Cloud Console で OAuth 2.0 クライアント ID を作成する（Desktop / Web のどちらか）

2. クライアント ID とクライアントシークレットを取得して、.env.template をコピーして .env に設定する:

```bash
cp .env.template .env
# 編集: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, 必要なら GOOGLE_REDIRECT_URI
```

3. 必要なパッケージをインストール:

```bash
npm install
```

4. 認可 URL を取得して認可コードを取得する:

```bash
npm run google:auth-url
# ブラウザで開き、許可した後に表示されるコードをコピー
npm run google:save-token -- <PASTE_CODE_HERE>
```

5. 動作確認:

```bash
npm run google:list-cals
npm run google:create-task -- @default "Test task from gentask" "notes"
npm run google:create-event -- primary "Meeting" "2026-04-06T09:00:00+09:00" "2026-04-06T10:00:00+09:00"
```

: トークンや機密情報はリポジトリにコミットしないこと。
