## 1. ディレクトリ構造

## 2. 通信基盤の実装 (`graph.ts`)

`az rest` を TypeScript から安全に呼び出すための抽象化レイヤーです。

```ts
import { execSync } from 'child_process';

        return JSON.parse(execSync(cmd, { input: payload, encoding: 'utf-8' }));
    }
};
```

AI が判定したタスクを、適切なグループ内のバケットへ配備する責務を負います。

```ts
import { graph } from './graph';
import { gen_task } from './index';

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

            console.log(`  [Deploying] Mode: ${task.mode} | Title: ${task.title}`);

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

        const result = { plan_id: plan_res.id, bucket_id: bucket_res.id };
        // 次回の同一モード呼び出しのためにキャッシュ
        this.plan_cache.set(mode, result);
        return result;
    }
}
```

## 4. AI エンジンと Flow の実装 (`index.ts`)

`zod` スキーマを最上位の設計図とし、Gemini 2.0 Flash に高度な判定を行わせます。

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

# 2. 該当するプランをループで安全に削除
echo "$PLANS" | jq -c '.[]' | while read -r plan; do
  PLAN_ID=$(echo "$plan" | jq -r '.id')
  PLAN_TITLE=$(echo "$plan" | jq -r '.title')
  PLAN_ETAG=$(echo "$plan" | jq -r '.etag')

echo "✨ Cleanup complete for $TARGET_DATETIME."
```