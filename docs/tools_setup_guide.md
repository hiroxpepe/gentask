# `tools` スクリプトの接続設定ガイド

`tools`ディレクトリに含まれる`check:graph`などのスクリプトは、外部API（Microsoft Graphなど）への接続をテストします。これらのスクriptsを正常に実行するには、事前の認証設定が必要です。

## 1. `check:graph` の実行と初期エラー

`npm run check:graph` を初めて実行すると、以下のエラーが発生する場合があります。

```
ERROR: Please run 'az login' to setup account.
```

これは、Azure CLIがM365にログインしていないことを示します。

## 2. `az login` の実行とサブスクリプションの問題

指示に従い `az login` を実行しても、アカウントに有効なAzureサブスクリプションが紐付いていない場合、ログインプロセスは完了せず、`check:graph`は依然として失敗します。

## 3. 解決策: `--allow-no-subscriptions`

`docs/setup.md` に記載されている通り、この問題は `--allow-no-subscriptions` フラグを使用して解決できます。

以下のコマンドを実行してください。

```sh
az login --allow-no-subscriptions
```

## 4. テナントの対話的選択

上記コマンドを実行すると、ブラウザでの認証後、ターミナルに以下のようなプロンプトが表示されます。

```
[Tenant and subscription selection]

No     Subscription name          Subscription ID                       Tenant
-----  -------------------------  ------------------------------------  ------------------------------------
[1] *  N/A(tenant level account)  xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

Select a subscription and tenant (Type a number or Enter for no changes):
```

ここで `[1]` または `Enter` を押し、`N/A(tenant level account)` を選択します。

## 5. 接続の成功

この手順が完了すると、`az` CLIは正しく認証され、`npm run check:graph` は成功し、ユーザー情報が取得できるようになります。基本的なスクリプトはこの時点で実行可能です。

## 6. E2Eテスト (`test:e2e-simple`) の実行と確認

`tools/create_task_e2e_simple.ts` スクリプトは、実際にPlannerタスクを作成するE2E（End-to-End）テストです。

### 実行方法

以下のコマンドでテストを実行します。

```sh
npm run test:e2e-simple
```

成功すると、コンソールに新しく作成されたタスクの情報が出力されます。

```
Plannerタスクの作成に成功しました！
  - Task ID: <ここに実際のタスクIDが出力される>

E2E（シンプル版）テストが正常に完了しました！
```

### UIへの反映遅延について

PlannerのWeb UIでは、APIで作成されたタスクが反映されるまでに数分から数十分、場合によってはそれ以上の時間がかかることがあります。

### `az` コマンドによる即時確認

タスクがバックエンドで正常に作成されたかを直ちに確認するには、Azure CLIを使用します。スクリプトの出力から `<タスクID>` をコピーし、以下のコマンドを実行してください。

```sh
az rest --method get --url https://graph.microsoft.com/v1.0/planner/tasks/<ここにタスクIDを貼り付け>
```

これにより、UIの表示を待たずに、作成されたタスクの情報をJSON形式で直接取得できます。

## 7. 総合E2Eテスト (`test:e2e`) のための追加権限

`npm run test:e2e` で実行される総合テストは、Plannerタスクの作成に加え、Outlook予定表との連携もテストします。そのため、標準のログインに加えて **「予定表の読み書き」** のAPI権限が追加で必要です。

### 追加権限の許可方法

以下の特別な `az login` コマンドを実行します。ブラウザが開き、追加の権限を許可（承諾）するよう求められます。

```sh
az login --scope https://graph.microsoft.com/User.Read https://graph.microsoft.com/Calendars.ReadWrite --allow-no-subscriptions
```

### 総合E2Eテストの実行

上記のログインが完了したら、テストを実行できます。

```sh
npm run test:e2e
```

成功すると、Plannerタスク、Outlook予定、そして両者のリンクが作成された旨のログが出力されます。

### 【トラブルシューティング】権限付与がうまくいかない場合

`az login` を実行しても権限付与が正しく行われない場合、より直接的で確実な方法として、アプリケーションのクライアントIDを直接指定して権限を付与するコマンドがあります。

1. `.env.dev` ファイルで `M365_CLIENT_ID` を確認します。
2. 管理者アカウントで `az login` していることを確認します。
3. 以下のコマンドを実行します。（ID `8083fe1f-a030-4979-a003-b75ea9811350` は `gentask-app-dev` のものです）

```bash
az ad app permission grant --id 8083fe1f-a030-4979-a003-b75ea9811350 --api 00000003-0000-0000-c000-000000000000 --scope "Tasks.ReadWrite,Calendars.ReadWrite"
```

このコマンドにより、必要な**アプリケーション権限**が直接、かつ確実に付与されます。

## 8. Vertex AI 接続テスト (`check:vertex`)

`tools/check_vertex_api.ts` スクリプトは、Google Cloud Vertex AIへの接続を検証します。

### 事前準備

このスクリプトは `genkit` を利用しており、実行にはGoogle Cloudの認証情報が必要です。環境変数 `GOOGLE_APPLICATION_CREDENTIALS` に、サービスアカウントキーのJSONファイルへのパスを正しく設定してください。

### 実行方法

以下のコマンドでテストを実行します。

```sh
npm run check:vertex
```

### 成功時の出力

接続に成功すると、以下のようなメッセージが表示されます。

```
Vertex AI への接続テストを開始します...
環境変数 GOOGLE_APPLICATION_CREDENTIALS が正しく設定されているか確認してください。
- 使用モデル: gemini-2.5-pro
✅ Vertex AIへの接続に成功しました！
   モデルからの応答: OK
```

"モデルから予期しない応答がありました" というエラーや、その他の認証エラーが表示された場合は、環境変数の設定やGoogle CloudプロジェクトのVertex AI APIが有効になっているかを確認してください。

## 9. サービスプリンシパルによる自動ログイン

CI/CD環境など、非対話形式で認証を行う場合は、ユーザーアカウントの代わりに「サービスプリンシパル」を使用します。`.env.dev` ファイルに記載されている以下の情報が必要です。

- `M365_CLIENT_ID` (クライアントID)
- `M365_CLIENT_SECRET` (クライアントシークレット)
- `M365_TENANT_ID` (テナントID)

### ログインコマンド

これらの情報を使って、以下のコマンドを実行します。

```sh
# .env.devから読み込む場合
CLIENT_ID=$(grep M365_CLIENT_ID .env.dev | cut -d '=' -f2)
CLIENT_SECRET=$(grep M365_CLIENT_SECRET .env.dev | cut -d '=' -f2)
TENANT_ID=$(grep M365_TENANT_ID .env.dev | cut -d '=' -f2)

az login --service-principal -u $CLIENT_ID -p $CLIENT_SECRET --tenant $TENANT_ID --allow-no-subscriptions
```

## 10. 【最終手段】権限エラーが解決しない場合 (アプリ再作成)

ここまでの手順を試しても `Forbidden` や `Insufficient privileges` といった権限エラーが解消しない場合、Azure Entra ID上のアプリケーション登録自体に問題がある可能性があります。

その場合、以下の手順でアプリケーションを一度完全に削除し、ゼロから再作成することで問題が解決する場合があります。

### ステップ1: Azure Portalで既存アプリケーションを削除

1.  [Azure Portalのアプリ登録ページ](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)にアクセスします。
2.  `gentask-app-dev` という名前のアプリケーションを見つけて選択します。
3.  「削除」をクリックして、アプリケーションを完全に削除します。

### ステップ2: アプリケーションの再作成と権限付与

既存のアプリを削除したら、以下のコマンドをターミナルで実行します。これにより、新しいアプリが作成され、正しい権限が付与され、`.env.dev` ファイルも更新されます。

**重要:** このコマンドは管理者アカウントで `az login` している状態で実行してください。

```bash
# --- 変数の設定 ---
DEV_M365_APP_NAME="gentask-app-dev"

# --- アプリケーションの新規作成 ---
echo "Creating new Entra application: $DEV_M365_APP_NAME..."
DEV_M365_CLIENT_ID=$(az ad app create --display-name "$DEV_M365_APP_NAME" --query appId -o tsv)

# --- 新しいシークレットの発行 ---
echo "Resetting credential for new app..."
DEV_M365_CLIENT_SECRET=$(az ad app credential reset --id "$DEV_M365_CLIENT_ID" --append --query password -o tsv)

# --- 必要なAPI権限を追加 ---
echo "Adding API permissions (Tasks.ReadWrite, Calendars.ReadWrite)..."
az ad app permission add --id "$DEV_M365_CLIENT_ID" --api 00000003-0000-0000-c000-000000000000 --api-permissions ef54d2bf-783f-4e4f-b221-c253813a1084=Role,10465709-ee8c-4db7-9679-5e73234a2753=Role

# --- 追加したすべての権限に管理者同意を与える ---
echo "Granting admin consent for all added permissions..."
az ad app permission admin-consent --id "$DEV_M365_CLIENT_ID"

# --- .env.dev を新しい情報で上書き ---
echo "Updating .env.dev with new credentials..."
M365_TENANT_ID=$(az account show --query tenantId -o tsv)

# 既存のM365関連以外の変数を保持するために一時ファイルを使用
grep -v "^M365_" .env.dev > .env.tmp || true

cat > .env.dev << EOF
PROJECT_ENV=DEV
M365_TENANT_ID=$M365_TENANT_ID
M365_CLIENT_ID=$DEV_M365_CLIENT_ID
M365_CLIENT_SECRET=$DEV_M365_CLIENT_SECRET
EOF

# 保持しておいた変数を追記
cat .env.tmp >> .env.dev
rm .env.tmp

echo "✅ Application re-creation complete. Please check the contents of .env.dev."
cat .env.dev
```

### ステップ3: 動作確認

再作成後、サービスプリンシパルでログインし直し、E2Eテストを実行して問題が解決したことを確認します。
