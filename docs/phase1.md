承知いたしました。これまでの設計思想、型定義、そしてエレガントな実装構造をすべて統合した **`phase1.md`** の決定版を「生マークダウン」でまとめます。
# Phase 1: GenTask 構築と M365 Planner 連携の実装

本フェーズでは、GenKit による AI 思考エンジンと Microsoft 365 Planner を物理的に接続し、AI が生成したタスクを動的に P/T/C/A 分類してデプロイする基盤を構築します。

## 1. ディレクトリ構造

```text
gentask/
├── .env.dev            # 開発環境設定
├── .env.prod           # 本番環境設定
├── package.json        # プロジェクト構成
├── graph.ts            # 通信基盤 (az rest wrapper)
├── planner.ts          # Planner 構築サービス
└── index.ts            # GenKit Flow & エントリポイント
```

## 2. 通信基盤の実装 (`graph.ts`)

`az rest` を TypeScript から安全に呼び出すための抽象化レイヤーです。

```ts
import { execSync } from 'child_process';

/**
 * @namespace graph
 * @description Microsoft Graph API に対する低レベル通信を担うオブジェクト。
 * Azure CLI (az rest) をラッパーとして使用し、認証管理を CLI 側に委任する。
 */
export const graph = {
    /**
     * @function post
     * @description 指定された URL に対して POST リクエストを送信する。
     * @param {string} url - リクエスト先の Graph API エンドポイント URL
     * @param {object} body - 送信する JSON ペイロードデータ
     * @returns {any} API から返却された JSON レスポンス
     */
    post: (url: string, body: object): any => {
        // オブジェクトを文字列化し、標準入力経由で az rest に渡す
        const payload = JSON.stringify(body);
        // --body @- は標準入力からデータを読み込む指定。エスケープ問題を回避する最も安全な方法。
        const cmd = `az rest --method post --url "${url}" --body @-`;

        return JSON.parse(execSync(cmd, { input: payload, encoding: 'utf-8' }));
    }
};
```

## 3. プランナー・サービスの実装 (`planner.ts`)

AI が判定したタスクを、適切なグループ内のバケットへ配備する責務を負います。

```ts
import { graph } from './graph';
import { gen_task } from './index';

/**
 * @class PlannerService
 * @description Microsoft 365 Planner 上にタスク構造を構築するサービス。
 * P/T/C/A モードごとにプランを 1 つに集約し、日次タイムスタンプで管理する。
 */
export class PlannerService {
    /** @private {string|undefined} m365_user_id - タスク割り当てに使用する実行ユーザーの ID */
    private m365_user_id = process.env.M365_USER_ID;

    /** @private {Map} plan_cache - 実行中に生成したプラン ID とバケット ID を保持し、再利用を可能にする */
    private plan_cache = new Map<string, { plan_id: string, bucket_id: string }>();

    /** @private {string} current_timestamp - 命名規則 {MODE}_{YYYYMMDD}_{HHMM} に使用する実行時時刻 */
    private current_timestamp: string;

    /**
     * @constructor
     * @description 実行時のタイムスタンプを生成し、インスタンスを初期化する。
     */
    constructor() {
        const now = new Date();
        // YYYYMMDD_HHMM 形式の生成（例: 20260103_1830）
        this.current_timestamp =
            now.getFullYear().toString() +
            (now.getMonth() + 1).toString().padStart(2, '0') +
            now.getDate().toString().padStart(2, '0') + "_" +
            now.getHours().toString().padStart(2, '0') +
            now.getMinutes().toString().padStart(2, '0');
    }

    /** @private {Record} label_map - スキーマのラベル名から Planner API のカテゴリ番号へのマッピング表 */
    private label_map: Record<string, string> = {
        'Pink': 'category1', 'Red': 'category2', 'Yellow': 'category3',
        'Green': 'category4', 'Blue': 'category5', 'Purple': 'category6'
    };

    /**
     * @method execute_deployment
     * @description AI が生成した複数のタスクをループし、適切な Planner プランへ配置する。
     * @param {gen_task[]} tasks - 展開対象となるタスクオブジェクトの配列
     * @returns {Promise<void>}
     */
    async execute_deployment(tasks: gen_task[]): Promise<void> {
        for (const task of tasks) {
            // 当該モード（P/T/C/A）に対応するプランとバケットを取得（なければ作成）
            const { plan_id, bucket_id } = await this.ensure_container(task.mode);

            console.log(`  [Deploying] Mode: ${task.mode} | Title: ${task.title}`);

            // タスクの物理作成
            await graph.post(`https://graph.microsoft.com/v1.0/planner/tasks`, {
                planId: plan_id,
                bucketId: bucket_id,
                title: task.title,
                priority: task.priority,
                // 実行ユーザーにタスクを自動割り当て
                assignments: {
                    [this.m365_user_id!]: {
                        "@odata.type": "#microsoft.graph.plannerAssignment",
                        "orderHint": " !"
                    }
                },
                // スキーマで指定されたカラーラベルを適用
                appliedCategories: { [this.label_map[task.label]]: true }
            });
        }
    }

    /**
     * @method ensure_container
     * @private
     * @description 特定のモードに対して、プランと "To Do" バケットが 1 つだけ存在することを保証する。
     * @param {string} mode - タスクのモード (PTASK, TTASK, CTASK, ATASK)
     * @returns {Promise<object>} plan_id と bucket_id を含むオブジェクト
     */
    private async ensure_container(mode: string): Promise<{ plan_id: string, bucket_id: string }> {
        // キャッシュに存在すれば、API 呼び出しをスキップして即復帰（プラン乱立防止）
        if (this.plan_cache.has(mode)) return this.plan_cache.get(mode)!;

        const group_id = process.env[`M365_PLANNER_${mode}_GROUP_ID`];
        // 指定された命名規則 {MODE}_{YYYYMMDD}_{HHMM} を適用
        const plan_title = `${mode}_${this.current_timestamp}`;

        // 1. 指定グループ内にプランを作成
        const plan_res = await graph.post(`https://graph.microsoft.com/v1.0/planner/plans`, {
            title: plan_title,
            container: {
                url: `https://graph.microsoft.com/v1.0/groups/${group_id}`,
                "@odata.type": "#microsoft.graph.plannerPlanContainer"
            }
        });

        // 2. 作成したプランの中に "To Do" バケットを作成
        const bucket_res = await graph.post(`https://graph.microsoft.com/v1.0/planner/buckets`, {
            name: "To Do",
            planId: plan_res.id
        });

        const result = { plan_id: plan_res.id, bucket_id: bucket_res.id };
        // 次回の同一モード呼び出しのためにキャッシュ
        this.plan_cache.set(mode, result);
        return result;
    }
}
```

## 4. AI エンジンと Flow の実装 (`index.ts`)

`zod` スキーマを最上位の設計図とし、Gemini 2.0 Flash に高度な判定を行わせます。

```ts
import { genkit, z } from 'genkit';
import { googleAI, gemini20Flash } from '@genkit-ai/googleai';
import * as dotenv from 'dotenv';
import { PlannerService } from './planner';

// 実行時の引数から環境(dev/prod)を特定し、対応する .env をロード
const target_env = process.argv[2] || 'dev';
dotenv.config({ path: `.env.${target_env}` });

/**
 * @description GenKit SDK の初期化設定。Google AI (Gemini) プラグインを使用。
 */
const ai_engine = genkit({
    plugins: [googleAI({ apiKey: process.env.GCP_VERTEX_AI_API_KEY })],
    model: gemini20Flash,
});

/**
 * @typedef {Object} task_schema
 * @description AI に生成を強制するタスクの厳密なデータ構造。
 * 各プロパティの describe は AI へのプロンプト指示として機能する。
 */
export const task_schema = z.object({
    title: z.string().min(1).max(255)
        .describe('タスクの簡潔なタイトル。実行内容が具体的にイメージできるもの。'),

    mode: z.enum(['PTASK', 'TTASK', 'CTASK', 'ATASK'])
        .describe(`タスクの性質に基づく厳密な分類：
      - PTASK: 思考・戦略・言語化・計画（エネルギー高）
      - TTASK: 技術検証・環境構築・実装・手順確立（中エネルギー）
      - CTASK: 制作・デザイン・手作業・コンテンツ作成（低エネルギー）
      - ATASK: 運用・管理・事務・ルーチン（随時）`),

    priority: z.number().min(1).max(9).default(5)
        .describe('Planner API 優先度。1:最優先（緊急）, 3:重要, 5:普通, 9:低。'),

    description: z.string()
        .describe('タスクの具体的な背景、達成条件、またはステップバイステップの手順。'),

    label: z.enum(['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Pink'])
        .describe(`視覚的な意味付けのためのラベル：
      - Red: 火急の対応が必要
      - Blue: 技術的なハードル・調査が必要
      - Green: 成果物に関連
      - Yellow: 検討・レビューが必要
      - Purple/Pink: その他、補足カテゴリ`)
});

/** @type {z.infer<typeof task_schema>} gen_task - スキーマから推論された TypeScript 型定義 */
export type gen_task = z.infer<typeof task_schema>;

/**
 * @function task_flow
 * @description 入力された題材を解析し、構造化されたタスク配列を生成する Flow。
 */
export const task_flow = ai_engine.defineFlow(
    {
        name: 'task_flow',
        inputSchema: z.string(),
        outputSchema: z.array(task_schema)
    },
    async (input_subject) => {
        const { output } = await ai_engine.generate({
            prompt: `あなたは超一流のマネージャーです。「${input_subject}」という目標を達成するために必要な具体的タスクを、
                    P(戦略)・T(技術)・C(制作)・A(事務) の全方位から網羅的に分解して出力してください。`,
            output: { schema: z.array(task_schema) },
        });
        if (!output) throw new Error('AI failed to generate valid task sequence.');
        return output;
    }
);

/**
 * @description エントリポイント処理。CLI 引数を受け取り、生成からデプロイまでを統括。
 */
(async () => {
    // 第4引数以降をすべて結合して題材（Subject）とする
    const input_subject = process.argv.slice(3).join(' ');
    if (!input_subject) {
        console.warn('Usage: npm run gen:dev -- "Your Subject"');
        return;
    }

    try {
        // 1. AI によるタスクの構造化生成
        const generated_tasks = await task_flow(input_subject);

        // 2. Planner サービスを使用して M365 へ展開
        const service_instance = new PlannerService();
        await service_instance.execute_deployment(generated_tasks);

        console.log(`\n✨ Successfully deployed ${generated_tasks.length} tasks.`);
    } catch (error) {
        console.error('Fatal execution error:', error);
    }
})();
```

## 5. 実行方法

1. **セットアップ**

```sh
npm install
```

2. **開発環境 (Dev) での実行**

```sh
# 代表グループに P/T/C/A すべてを集約してテスト
npm run gen:dev -- "オフィスの移転計画"
```

3. **本番環境 (Prod) での実行**

```sh
# 実際の 4 つの部署（グループ）にタスクを自動配備
npm run gen:prod -- "新規プロダクトの市場投入"
```

4. **指定した日時のプラン（P/T/C/Aのセット）を一括で消すためのメンテナンスコマンド**

```sh
# 消したい日時を指定（例：18時00分の実行分を消す場合）
TARGET_DATETIME="20260103_1829"

# 1. 指定した日時に一致するプラン（PTASK_, TTASK_, CTASK_, ATASK_）を抽出
echo "🔍 Searching for plans from: $TARGET_DATETIME ..."
PLANS=$(az rest --method get \
  --url "https://graph.microsoft.com/v1.0/groups/$M365_PLANNER_PTASK_GROUP_ID/planner/plans" \
  --query "value[?contains(title, '$TARGET_DATETIME')].{id:id, title:title, etag:\"@odata.etag\"}" -o json)

# 2. 該当するプランをループで安全に削除
echo "$PLANS" | jq -c '.[]' | while read -r plan; do
  PLAN_ID=$(echo "$plan" | jq -r '.id')
  PLAN_TITLE=$(echo "$plan" | jq -r '.title')
  PLAN_ETAG=$(echo "$plan" | jq -r '.etag')

  echo "🗑️ Deleting: $PLAN_TITLE ..."
  
  az rest --method delete \
    --url "https://graph.microsoft.com/v1.0/planner/plans/$PLAN_ID" \
    --header "If-Match=$PLAN_ETAG"
done

echo "✨ Cleanup complete for $TARGET_DATETIME."
```