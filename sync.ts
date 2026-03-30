import { genkit, z } from 'genkit';
import { googleAI, gemini20Flash } from '@genkit-ai/googleai';
import * as dotenv from 'dotenv';
import { validate_env } from './env';
import { OutlookService } from './outlook';
import { graph } from './graph';
import { sync_action_schema, type sync_input_item, type sync_action } from './types';

// 環境設定
const target_env = process.argv[2] || 'dev';
dotenv.config({ path: `.env.${target_env}` });
validate_env();

const ai_engine = genkit({
    plugins: [googleAI({ apiKey: process.env.GCP_VERTEX_AI_API_KEY })],
    model: gemini20Flash,
});

/**
 * @function sync_flow
 * @description Outlook イベントの変化を AI が解釈し、Planner への操作指示（sync_action[]）を生成する Flow。
 */
export const sync_flow = ai_engine.defineFlow(
    {
        name: 'sync_flow',
        inputSchema: z.array(z.object({
            outlookEventId: z.string(),
            plannerTaskId:  z.string(),
            subject:        z.string(),
            bodyContent:    z.string(),
            currentStatus:  z.number(),
        })),
        outputSchema: z.array(sync_action_schema),
    },
    async (items) => {
        if (items.length === 0) return [];

        const items_text = items.map((item, i) =>
            `[${i + 1}] タスクID: ${item.plannerTaskId}\n` +
            `    件名: ${item.subject}\n` +
            `    本文: ${item.bodyContent.trim().slice(0, 300)}\n` +
            `    現在の進捗: ${item.currentStatus}%`
        ).join('\n\n');

        const { output } = await ai_engine.generate({
            prompt: `あなたはプロジェクト管理AIです。以下はOutlookカレンダーの予定一覧です。
各予定の本文に書かれた内容を分析し、Plannerタスクへの更新指示を出力してください。

判断基準：
- "ok"、"完了"、"done"、"済" → complete
- 予定が後ろにずれた・"明日やる"・"後回し" → reschedule
- 進捗メモ・気づき・作業ログ → add_note
- "神回"、"倍かかった"、バッファ消費を示す記述 → buffer_consumed
- 特に変化なし・白紙・デフォルト文面 → no_change

予定一覧:
${items_text}`,
            output: { schema: z.array(sync_action_schema) },
        });

        if (!output) throw new Error('AI failed to generate sync actions.');
        return output;
    }
);

/**
 * @class PlannerSyncService
 * @description sync_flow の出力を受け取り、Planner に実際の変更を適用するサービス。
 */
class PlannerSyncService {
    private readonly base_url = 'https://graph.microsoft.com/v1.0/planner/tasks';

    async apply_actions(actions: sync_action[]): Promise<void> {
        for (const action of actions) {
            if (action.action === 'no_change') continue;

            console.log(`  [Sync] ${action.action} → Task: ${action.plannerTaskId}`);

            const task_url = `${this.base_url}/${action.plannerTaskId}`;

            switch (action.action) {
                case 'complete': {
                    const task = await graph.get(task_url);
                    await graph.patch(task_url, { percentComplete: 100 }, {
                        'If-Match': task['@odata.etag']
                    });
                    break;
                }

                case 'reschedule': {
                    if (!action.newDueDate) break;
                    const task = await graph.get(task_url);
                    await graph.patch(task_url, { dueDateTime: action.newDueDate }, {
                        'If-Match': task['@odata.etag']
                    });
                    break;
                }

                case 'add_note':
                case 'buffer_consumed': {
                    if (!action.note) break;
                    const details_url = `${this.base_url}/${action.plannerTaskId}/details`;
                    const details = await graph.get(details_url);
                    const prev = (details.description as string | undefined) ?? '';
                    const updated = prev
                        ? `${prev}\n\n---\n${new Date().toISOString()}: ${action.note}`
                        : `${new Date().toISOString()}: ${action.note}`;
                    await graph.patch(details_url, { description: updated }, {
                        'If-Match': details['@odata.etag']
                    });
                    break;
                }
            }
        }
    }
}

/**
 * @description sync コマンドのエントリポイント。
 * Outlook から紐付き予定を取得 → AI で解釈 → Planner に反映する。
 */
(async () => {
    try {
        const outlook = new OutlookService();
        const sync_svc = new PlannerSyncService();

        // 1. Outlook から gentask 拡張付き予定を取得
        console.log('🔍 Fetching linked Outlook events...');
        const linked_events = await outlook.get_linked_events();

        if (linked_events.length === 0) {
            console.log('✅ No linked events found. Nothing to sync.');
            return;
        }
        console.log(`   Found ${linked_events.length} event(s).`);

        // 2. 対応 Planner タスクの現在 percentComplete を取得してマップ構築
        const status_map = new Map<string, number>();
        for (const event of linked_events) {
            const ext = event.extensions?.find(e => e.id === 'com.gentask.v1');
            if (!ext?.plannerTaskId) continue;
            const task = await graph.get(
                `https://graph.microsoft.com/v1.0/planner/tasks/${ext.plannerTaskId}`
            );
            status_map.set(ext.plannerTaskId, task.percentComplete as number ?? 0);
        }

        // 3. sync_flow への入力を組み立て
        const sync_inputs: sync_input_item[] = outlook.build_sync_inputs(linked_events, status_map);

        // 4. AI で変化を解釈
        console.log('🤖 Analyzing changes with AI...');
        const actions = await sync_flow(sync_inputs);
        const active = actions.filter(a => a.action !== 'no_change');
        console.log(`   ${active.length} action(s) to apply.`);

        // 5. Planner に反映
        await sync_svc.apply_actions(actions);

        console.log(`\n✨ Sync complete. ${active.length} task(s) updated.`);
    } catch (error) {
        console.error('Fatal sync error:', error);
    }
})();
