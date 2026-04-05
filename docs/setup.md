# 初期構築手順

## 1. Gentask の 4 つのコア・タスク概念

Gentask は、タスクを単なる「やるべきこと」ではなく、**「今の自分がどのモード（エネルギー）か」**を基準に 4 つに分類します。

## 2. Dev 環境における「4 つの ID 同一」の理屈

論理的には 4 つの役割に分かれていますが、開発・検証（Dev）の段階では、これら 4 つのタスクの「投げ先（GroupID）」をすべて **同一のサンドボックス ID（代表グループ）** に向けます。

### **なぜ同一にするのか？**

* **安全な破壊と再生:** 開発中はプランを何度も作っては消します。4 つの ID が「代表」に集約されていれば、他部署の本番環境を汚す心配なく、一つの場所で P/T/C/A すべての挙動（バケット振り分けや表示確認）を完結させられます。
* **疎通確認の単純化:** 接続先を 1 つに絞ることで、API の認証や権限エラーの切り分けが容易になります。

## 3. 実行時の動作イメージ（概念図）

GenKit が「これは P モードのタスクだ」と判定したとき、システムは以下のように動きます。

1. **論理判定:** 「これは `PTASK` だから、`PLANNING` ロールの ID を参照しよう」
2. **ID 解決:**
* **Dev の場合:** `PLANNING` 用の ID を引くと **「代表グループ ID」** が返る。
* **Prod の場合:** `PLANNING` 用の ID を引くと **「企画T グループ ID」** が返る。

3. **実行:** 解決された ID（Dev なら代表）の中にプランを作り、`🟧Planning` バケットにタスクを放り込む。

## まとめ：Gentask が実現すること

この設計により、**「コード側は『どの部署のタスクか』という抽象的なロールを指定するだけ」** で、環境変数（.env）を差し替えるだけで、開発時は一つの箱に、本番では四つの部署へ、魔法のようにタスクが整理されて飛んでいくことになります。

「Dev の場合、4 つの ID は同一」という設定は、**「本番の挙動を模倣しつつ、安全な実験場で全機能をテストする」** ための、最もスマートな解です。

## 命名規則

プラットフォーム間の制約をクリアしつつ、開発の慣習に従う

+ **環境変数 (Shell/Env)**: `GENTASK_CLIENT_ID` (UPPER_SNAKE_CASE)
    + 全て大文字、アンダースコア繋ぎ。シェルの慣習に従う

## ツールの確認

```sh
node -v
az --version
gcloud --version
```

## Google Cloud SDK のインストール（インストール中にいくつか質問（パスを通すか等）が出ますが、すべて Y または Enter で進める）

```sh
curl https://sdk.cloud.google.com | bash
```

## 環境変数を反映

```sh
exec -l $SHELL
```

## 確認

```sh
gcloud --version
Google Cloud SDK 550.0.0
bq 2.1.26
bundled-python3-unix 3.13.10
core 2025.12.12
gcloud-crc32c 1.0.0
gsutil 5.35
```

### 命名ルール（統合版）

### Microsoft Entra アプリの作成

```sh
az ad group list --filter "groupTypes/any(c:c eq 'Unified')" \
  --query "[].{DisplayName:displayName, GroupID:id}" -o table
DisplayName    GroupID
-------------  ------------------------------------
代表           xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
管理T          xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
企画T          xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
技術T          xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
制作T          xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
All Company    xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

承知いたしました。ヒアドキュメント（EOF）を使用してエスケープと `set +H` を排除した、最もクリーンな「生マークダウン」の手順書です。

### 1. 環境変数のセット

### 2. プランの作成

### 3. バケットの作成

### 4. タスクの投入

### 5. 削除（クリーンアップ）

### 6. 最終確認

## Google Cloud CLI ログイン

```sh
# 1. ログイン実行
# ブラウザが立ち上がるので、GCPを利用するアカウントで承認してください。
gcloud auth login
```

## Google Cloud プロジェクト作成

```sh
# 1. 開発用プロジェクト作成
export DEV_GCP_PROJECT_ID="gentask-dev"
gcloud projects create "$DEV_GCP_PROJECT_ID" --name="gentask-dev"

# 2. 本番用プロジェクト作成
export PROD_GCP_PROJECT_ID="gentask-prod"
gcloud projects create "$PROD_GCP_PROJECT_ID" --name="gentask-prod"
```

```sh
# DEV環境の記録
echo "PROJECT_ENV=DEV" >> .env.dev
echo "GCP_PROJECT_ID=$DEV_GCP_PROJECT_ID" >> .env.dev

# PROD環境の記録
echo "PROJECT_ENV=PROD" >> .env.prod
echo "GCP_PROJECT_ID=$PROD_GCP_PROJECT_ID" >> .env.prod
```

## Google Cloud プロジェクト 課金アカウントの紐付け

```sh
# 課金アカウントIDを自動で取得して変数に格納
# (複数のアカウントがある場合は、一番上のものを取得します)
export GCP_BILLING_ID=$(gcloud billing accounts list --format="value(name)" --limit=1)

# 取得できたか確認（ここだけ目視してください）
echo "Using Billing Account: $GCP_BILLING_ID"
```

```sh
# 1. DEV プロジェクトの紐付け
gcloud billing projects link "$DEV_GCP_PROJECT_ID" --billing-account "$GCP_BILLING_ID"

# 2. PROD プロジェクトの紐付け
gcloud billing projects link "$PROD_GCP_PROJECT_ID" --billing-account "$GCP_BILLING_ID"
```

```sh
# 両方のプロジェクトが billingEnabled: true になっているか確認
gcloud billing projects list --billing-account "$GCP_BILLING_ID"
```

```sh
# DEVに追記
echo "GCP_BILLING_ID=$GCP_BILLING_ID" >> .env.dev

# PRODに追記
echo "GCP_BILLING_ID=$GCP_BILLING_ID" >> .env.prod
```

## Google Cloud プロジェクト APIと認証の設定

+ **Vertex AI API**: 開発・本番の両プロジェクトで有効化済み。これにより Gemini Pro 等のモデルが利用可能
+ **サービスアカウント名**: `gentask-api-user` (共通ID)
+ **表示名の区別**: 
  - DEV環境: `Gentask API Service Account (Dev)`
  - PROD環境: `Gentask API Service Account (Prod)`
+ **権限**: 両環境で `roles/aiplatform.user` を付与し、Gemini へのアクセスを確立

```sh
# 1. 操作対象が DEV になっているか念のため確認
gcloud config set project "$DEV_GCP_PROJECT_ID"

# 2. Vertex AI API (Gemini用) を有効化
# --async を付けないことで、完了するまで待機します
gcloud services enable aiplatform.googleapis.com
```

```sh
# 1. 操作対象を PROD に切り替え
gcloud config set project "$PROD_GCP_PROJECT_ID"

# 2. Vertex AI API を有効化
gcloud services enable aiplatform.googleapis.com

# 3. 操作対象を DEV に戻しておく（事故防止）
gcloud config set project "$DEV_GCP_PROJECT_ID"
```

### Google Cloud 身分証（アカウント）の発行

```sh
# 開発環境の中に、AI操作専用の「人ではないアカウント」を作成
gcloud iam service-accounts create gentask-api-user \
    --display-name="Gentask API Service Account (Dev)"
```

```sh
# 変数を使って、作成したサービスアカウントに「AI使用権限」をバインド（紐付け）
gcloud projects add-iam-policy-binding "$DEV_GCP_PROJECT_ID" \
    --member="serviceAccount:gentask-api-user@$DEV_GCP_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/aiplatform.user"
```

```sh
# 1. 操作対象を PROD プロジェクトに切り替え
gcloud config set project "$PROD_GCP_PROJECT_ID"

# 2. 本番用のサービスアカウント作成
gcloud iam service-accounts create gentask-api-user \
    --display-name="Gentask API Service Account (Prod)"
```

```sh
# 3. 本番プロジェクトの権限をバインド
gcloud projects add-iam-policy-binding "$PROD_GCP_PROJECT_ID" \
    --member="serviceAccount:gentask-api-user@$PROD_GCP_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/aiplatform.user"
```

## Google Cloud 管理用 API の一括有効化

```sh
# 1. DEV プロジェクトに対して管理用APIを有効化
gcloud services enable cloudresourcemanager.googleapis.com --project="$DEV_GCP_PROJECT_ID"
```

```sh
# 2. PROD プロジェクトに対して管理用APIを有効化
gcloud services enable cloudresourcemanager.googleapis.com --project="$PROD_GCP_PROJECT_ID"
```

## Google Cloud Generative Language API の有効化

```sh
# DEVプロジェクトで有効化
gcloud services enable generativelanguage.googleapis.com --project="$DEV_GCP_PROJECT_ID"

# PRODプロジェクトで有効化
gcloud services enable generativelanguage.googleapis.com --project="$PROD_GCP_PROJECT_ID"
```

## 疎通確認（ハロー・ジェミニ）

```sh
# プロジェクトとアカウントの基本情報
gcloud config list

# プロジェクトが ACTIVE か確認
gcloud projects list

# サービスアカウントの表示名が (Dev) / (Prod) になっているか
gcloud iam service-accounts list --project="$DEV_GCP_PROJECT_ID"
```

## API キーの作成

vertex-ai-key という表示名で作成

```sh
# DEV
gcloud alpha services api-keys create --display-name="vertex-ai-key" --project="$DEV_GCP_PROJECT_ID"

# PROD
gcloud alpha services api-keys create --display-name="vertex-ai-key" --project="$PROD_GCP_PROJECT_ID"
```

.env ファイルに保存

```sh
# 1. 表示名 vertex-ai-key から UID (nameの末尾) を自動取得
DEV_KEY_UID=$(gcloud alpha services api-keys list \
    --project="$DEV_GCP_PROJECT_ID" \
    --filter="displayName:vertex-ai-key" \
    --format="value(name.scope().segment(-1))")

# 2. そのUIDを使い、直接リソース指定してキー文字列を取得
DEV_KEY_VAL=$(gcloud alpha services api-keys get-key-string \
    "projects/${DEV_GCP_PROJECT_ID}/locations/global/keys/${DEV_KEY_UID}" \
    --format="value(keyString)")

# 3. 反映確認と保存
if [ -n "$DEV_KEY_VAL" ]; then
    echo "GCP_VERTEX_AI_API_KEY=$DEV_KEY_VAL" >> .env.dev
    echo "Successfully saved to .env.dev (UID: $DEV_KEY_UID)"
else
    echo "Failed to retrieve the key string for DEV."
fi
```

```sh
# 1. 表示名 vertex-ai-key から UID を自動取得
PROD_KEY_UID=$(gcloud alpha services api-keys list \
    --project="$PROD_GCP_PROJECT_ID" \
    --filter="displayName:vertex-ai-key" \
    --format="value(name.scope().segment(-1))")

# 2. そのUIDを使い、直接リソース指定してキー文字列を取得
PROD_KEY_VAL=$(gcloud alpha services api-keys get-key-string \
    "projects/${PROD_GCP_PROJECT_ID}/locations/global/keys/${PROD_KEY_UID}" \
    --format="value(keyString)")

# 3. 反映確認と保存
if [ -n "$PROD_KEY_VAL" ]; then
    echo "GCP_VERTEX_AI_API_KEY=$PROD_KEY_VAL" >> .env.prod
    echo "Successfully saved to .env.prod (UID: $PROD_KEY_UID)"
else
    echo "Failed to retrieve the key string for PROD."
fi
```

### 疎通確認

```sh
export DEV_KEY=$(grep GCP_VERTEX_AI_API_KEY .env.dev | cut -d '=' -f2)

# 正しい最新モデル名 'gemini-2.0-flash' を使用
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"contents": [{"parts": [{"text": "Hello Gemini! Finally found you. This is Gemini 2.0 Flash."}]}]}' \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${DEV_KEY}"
```

```sh
export PROD_KEY=$(grep GCP_VERTEX_AI_API_KEY .env.prod | cut -d '=' -f2)

curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"contents": [{"parts": [{"text": "Hello Gemini! PROD check with Gemini 2.0 Flash."}]}]}' \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${PROD_KEY}"
```

## Genkit (Node.js) 環境のセットアップ

```sh
# プロジェクトの初期化（package.json作成）
npm init -y

# 既存の不要パッケージをすべて削除
npm uninstall genai @genkit-ai/ai @genkit-ai/core @genkit-ai/googleai

# 本番用ライブラリと開発用ツール（tsx）をまとめてインストール
npm install genkit @genkit-ai/googleai zod dotenv && npm install -D tsx
```

## . package.json の修正

```sh
{
  "name": "gentask",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "gen:dev": "tsx index.ts dev",
    "gen:prod": "tsx index.ts prod"
  },
  "dependencies": {
    "genkit": "latest",
    "@genkit-ai/googleai": "latest",
    "zod": "latest",
    "dotenv": "latest"
  },
  "devDependencies": {
    "tsx": "latest",
    "typescript": "^5.0.0"
  }
}
```

## index.ts の作成

```sh
import { genkit, z } from 'genkit';
import { googleAI, gemini20Flash } from '@genkit-ai/googleai';
import * as dotenv from 'dotenv';
import { existsSync, writeFileSync } from 'fs';

// 1. 環境設定
const env = process.argv[2] || 'dev';
const envFile = `.env.${env}`;
if (!existsSync(envFile)) {
    console.error(`❌ ${envFile} がありません。`);
    process.exit(1);
}
dotenv.config({ path: envFile });

// 2. Genkit 初期化
const ai = genkit({
    plugins: [googleAI({ apiKey: process.env.GCP_VERTEX_AI_API_KEY })],
    model: gemini20Flash,
});

// 3. タスクの型定義（スキーマ）
const TaskSchema = z.object({
    title: z.string(),
    priority: z.enum(['High', 'Medium', 'Low']),
    description: z.string(),
});

// 4. Flow の定義
export const taskFlow = ai.defineFlow(
    {
        name: 'taskFlow',
        inputSchema: z.string(),
        outputSchema: z.array(TaskSchema), // 文字列ではなく「タスクの配列」を返す
    },
    async (subject) => {
        const { output } = await ai.generate({
            prompt: `「${subject}」について、今日やるべきタスクを3つ、構造化データとして作成してください。`,
            output: { schema: z.array(TaskSchema) }, // ここで出力を強制
        });

        if (!output) throw new Error('タスクの生成に失敗しました。');
        return output;
    }
);

// 5. 実行
(async () => {
    try {
        const subject = process.argv.slice(3).join(' ') || '全体最適化';
        console.log(`\n🚀 Mode: ${env.toUpperCase()} / Subject: ${subject}\n`);

        const tasks = await taskFlow(subject);

        // ターミナルで見やすく表示
        console.log(`--- 今日のタスクリスト ---`);
        tasks.forEach((t, i) => {
            const icon = t.priority === 'High' ? '🔴' : t.priority === 'Medium' ? '🟡' : '🟢';
            console.log(`${i + 1}. [${t.priority}] ${t.title}`);
            console.log(`   └ ${t.description}\n`);
        });

        // JSON と Markdown 両方で保存
        writeFileSync(`tasks_${env}.json`, JSON.stringify(tasks, null, 2));
        const mdContent = `# Tasks: ${subject}\n\n` +
            tasks.map(t => `### ${t.title} (${t.priority})\n${t.description}`).join('\n\n');
        writeFileSync(`tasks_${env}.md`, mdContent);

        console.log(`✅ JSON と Markdown で保存完了しました。`);
    } catch (error) {
        console.error('❌ Error:', error);
    }
})();
```

## 実行

```sh
# DEV 環境で実行
npm run gen:dev -- "新しいプログラミング言語の学習"

# PROD 環境で実行
npm run gen:prod -- "プロジェクトの最終レビュー"
```

```sh
# フォーマット: npx tsx index.ts [環境] "[題材]"
npx tsx index.ts dev "今日の晩御飯の献立作成"
```
