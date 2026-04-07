import { genkit, z } from 'genkit';
import { googleAI, gemini20Flash } from '@genkit-ai/googleai';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { createOAuthClient } from '../src/google';
import { GoogleContainerManager } from '../src/google-container-manager';
import { task_schema, type gen_task } from '../lib/types';
import { validate_env } from '../lib/env';

const ai_engine = genkit({
    plugins: [googleAI({ apiKey: process.env.GCP_VERTEX_AI_API_KEY })],
    model: gemini20Flash,
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

        // 2. Google Tasks + Calendar へ展開
        const auth            = createOAuthClient();
        const manager         = new GoogleContainerManager();
        const tasks_client    = google.tasks({ version: 'v1', auth });
        const cal_client      = google.calendar({ version: 'v3', auth });
        const calendar_id     = process.env.GOOGLE_CALENDAR_ID!;

        for (const task of generated_tasks) {
            const bucket: 'current' | 'next' =
                (task.bucket as 'current' | 'next' | undefined) ??
                (task.mode === 'PTASK' ? 'next' : 'current');

            const container = await manager.get_container(task.mode, auth);
            const list_id   = container[bucket];

            // Google Tasks にタスク作成
            const task_res = await tasks_client.tasks.insert({
                tasklist: list_id,
                requestBody: {
                    title: task.title,
                    notes: task.description,
                },
            });
            const task_id = task_res.data.id!;

            // Google Calendar にイベント作成（30分後開始・60分後終了）
            const start_dt = new Date(Date.now() + 30 * 60_000);
            const end_dt   = new Date(Date.now() + 60 * 60_000);

            const event_res = await cal_client.events.insert({
                calendarId: calendar_id,
                requestBody: {
                    summary:     `[${task.mode}] ${task.title}`,
                    description: task.description,
                    start: { dateTime: start_dt.toISOString() },
                    end:   { dateTime: end_dt.toISOString() },
                    extendedProperties: {
                        private: {
                            gentask_taskId: task_id,
                            gentask_listId: list_id,
                        },
                    },
                },
            });
            const event_id = event_res.data.id!;

            // タスクの notes に双方向リンクを追記
            await tasks_client.tasks.update({
                tasklist: list_id,
                task:     task_id,
                requestBody: {
                    id:    task_id,
                    title: task.title,
                    notes: `${task.description}\n[gentask:{"eventId":"${event_id}","calendarId":"${calendar_id}","listId":"${list_id}"}]`,
                },
            });

            console.log(`  ✅ ${task.mode} | ${task.title}`);
        }

        console.log(`\n✨ Successfully deployed ${generated_tasks.length} tasks.`);
    } catch (error) {
        console.error('Fatal execution error:', error);
    }
})();
}