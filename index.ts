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