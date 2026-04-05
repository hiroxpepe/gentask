import { genkit, z } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { PlannerService } from '../src/planner';
import { task_schema, type gen_task } from '../lib/types';
import { validate_env } from '../lib/env';

const ai_engine = genkit({
    plugins: [vertexAI({ location: 'asia-northeast1' })],
    model: vertexAI.model('gemini-2.5-pro'),
});

export { task_schema, type gen_task };

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
const is_main = process.argv[1] === fileURLToPath(import.meta.url);
if (is_main) {
    // CLI 専用の副作用: 環境設定とバリデーションをエントリポイント内に限定
    const target_env = process.argv[2] || 'dev';
    dotenv.config({ path: `.env.${target_env}` });
    validate_env();

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
}