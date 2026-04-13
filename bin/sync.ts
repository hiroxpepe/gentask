import { genkit, z } from 'genkit';
import { googleAI, gemini20Flash } from '@genkit-ai/googleai';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { validate_env } from '../lib/env';
import { google } from 'googleapis';
import { createOAuthClient } from '../src/google';
import { snapshot } from '../lib/snapshot';
import {
    sync_action_schema,
    type sync_input_item,
    type sync_action,
    decode_gentask_metadata,
} from '../lib/types';

const ai_engine = genkit({
    plugins: [googleAI({ apiKey: process.env.GCP_VERTEX_AI_API_KEY })],
    model: gemini20Flash,
});

/**
 * @function sync_flow
 * @description Google Calendar イベントの変化を AI が解釈し、Google Tasks への操作指示（sync_action[]）を生成する Flow。
 */
export const sync_flow = ai_engine.defineFlow(
    {
        name: 'sync_flow',
        inputSchema: z.array(z.object({
            eventId:       z.string(),
            taskId:        z.string(),
            listId:        z.string(),
            subject:       z.string(),
            bodyContent:   z.string(),
            currentStatus: z.number(),
        })),
        outputSchema: z.array(sync_action_schema),
    },
    async (items) => {
        if (items.length === 0) return [];

        const items_text = items.map((item, i) =>
            `[${i + 1}] タスクID: ${item.taskId}\n` +
            `    件名: ${item.subject}\n` +
            `    本文: ${item.bodyContent.trim().slice(0, 300)}\n` +
            `    現在の進捗: ${item.currentStatus}%`
        ).join('\n\n');

        const { output } = await ai_engine.generate({
            prompt: `あなたはプロジェクト管理AIです。以下はGoogle Calendarの予定一覧です。
各予定の本文に書かれた内容を分析し、Google Tasksへの更新指示を出力してください。

判断基準：
- "ok"、"完了"、"done"、"済" → complete
- 予定が後ろにずれた・"明日やる"・"後回し" → reschedule
- 進捗メモ・気づき・作業ログ → add_note
- "神回"、"倍かかった"、バッファ消費を示す記述 → buffer_consumed
- "undo"、"戻して"、"元に戻す" → undo（直前の操作を取り消す）
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
 * @class GoogleSyncService
 * @description sync_flow の出力を受け取り、Google Tasks に実際の変更を適用するサービス。
 */
export class GoogleSyncService {
    /**
     * @method apply_actions
     * @description AI が生成したアクション配列を Google Tasks API に反映する。
     * @param actions AI が生成した同期アクション一覧
     * @param list_map taskId → listId の対応マップ
     */
    async apply_actions(
        actions: sync_action[],
        list_map: Map<string, string>
    ): Promise<void> {
        const auth         = createOAuthClient();
        const tasks_client = google.tasks({ version: 'v1', auth });

        for (const action of actions) {
            if (action.action === 'no_change') continue;

            const task_id = action.taskId;
            const list_id = list_map.get(task_id);

            if (!list_id) {
                console.warn(`  [Sync] listId not found for taskId: ${task_id}. Skipping.`);
                continue;
            }

            console.log(`  [Sync] ${action.action} → Task: ${task_id}`);

            switch (action.action) {
                case 'complete': {
                    // 操作前にスナップショットを保存（undo 用）
                    const before = await tasks_client.tasks.get({ tasklist: list_id, task: task_id });
                    const meta   = decode_gentask_metadata(before.data.notes);
                    if (meta) {
                        snapshot.save(meta.uuid, task_id, list_id, {
                            title:  before.data.title  ?? '',
                            notes:  before.data.notes  ?? '',
                            status: before.data.status ?? 'needsAction',
                            due:    before.data.due    ?? undefined,
                        });
                    }
                    await tasks_client.tasks.update({
                        tasklist: list_id,
                        task:     task_id,
                        requestBody: { id: task_id, status: 'completed' },
                    });
                    break;
                }

                case 'reschedule': {
                    if (!action.newDueDate) break;
                    const before = await tasks_client.tasks.get({ tasklist: list_id, task: task_id });
                    const meta   = decode_gentask_metadata(before.data.notes);
                    if (meta) {
                        snapshot.save(meta.uuid, task_id, list_id, {
                            title:  before.data.title  ?? '',
                            notes:  before.data.notes  ?? '',
                            status: before.data.status ?? 'needsAction',
                            due:    before.data.due    ?? undefined,
                        });
                    }
                    await tasks_client.tasks.update({
                        tasklist: list_id,
                        task:     task_id,
                        requestBody: { id: task_id, due: action.newDueDate },
                    });
                    break;
                }

                case 'add_note':
                case 'buffer_consumed': {
                    if (!action.note) break;
                    const current = await tasks_client.tasks.get({
                        tasklist: list_id,
                        task:     task_id,
                    });
                    const meta    = decode_gentask_metadata(current.data.notes);
                    if (meta) {
                        snapshot.save(meta.uuid, task_id, list_id, {
                            title:  current.data.title  ?? '',
                            notes:  current.data.notes  ?? '',
                            status: current.data.status ?? 'needsAction',
                            due:    current.data.due    ?? undefined,
                        });
                    }
                    const prev    = current.data.notes ?? '';
                    const updated = prev
                        ? `${prev}\n\n---\n${new Date().toISOString()}: ${action.note}`
                        : `${new Date().toISOString()}: ${action.note}`;
                    await tasks_client.tasks.update({
                        tasklist: list_id,
                        task:     task_id,
                        requestBody: { id: task_id, notes: updated },
                    });
                    break;
                }

                case 'undo': {
                    // UUID を notes から読み取り、UUID ベースでスナップショットを復元
                    const current = await tasks_client.tasks.get({ tasklist: list_id, task: task_id });
                    const meta    = decode_gentask_metadata(current.data.notes);
                    if (!meta) {
                        console.warn(`  [Undo] No gentask metadata in notes for task: ${task_id}`);
                        break;
                    }
                    const snap = snapshot.restore(meta.uuid);
                    if (!snap) {
                        console.warn(`  [Undo] No snapshot found for uuid: ${meta.uuid}`);
                        break;
                    }
                    await tasks_client.tasks.update({
                        tasklist: list_id,
                        task:     task_id,
                        requestBody: { id: task_id, ...snap.state },
                    });
                    break;
                }
            }
        }
    }
}

/**
 * @description sync コマンドのエントリポイント。
 * Google Calendar から紐付き予定を取得 → AI で解釈 → Google Tasks に反映する。
 * @param sync_svc テスト時に差し替え可能なサービスインスタンス
 */
export async function main(
    sync_svc = new GoogleSyncService()
) {
    try {
        const auth         = createOAuthClient();
        const cal_client   = google.calendar({ version: 'v3', auth });
        const tasks_client = google.tasks({ version: 'v1', auth });
        const calendar_id  = process.env.GOOGLE_CALENDAR_ID!;

        // 1. gentask UUID リンク付きカレンダーイベントを GENTASK_SYNC_WINDOW_DAYS 日分取得
        console.log('🔍 Fetching linked Google Calendar events...');
        const sync_days     = parseInt(process.env.GENTASK_SYNC_WINDOW_DAYS ?? '365', 10);
        const window_start  = new Date(Date.now() - sync_days * 24 * 60 * 60_000).toISOString();

        const events_res = await cal_client.events.list({
            calendarId:              calendar_id,
            timeMin:                 window_start,
            privateExtendedProperty: 'gentask_uuid',
            singleEvents:            true,
            orderBy:                 'startTime',
        });

        const events = events_res.data.items ?? [];
        if (events.length === 0) {
            console.log('✅ No linked events found. Nothing to sync.');
            return;
        }
        console.log(`   Found ${events.length} event(s).`);

        // 2. 各イベントから taskId / listId を取得し、タスクのステータスを確認
        const sync_inputs: sync_input_item[] = [];
        const list_map = new Map<string, string>(); // taskId → listId

        for (const event of events) {
            const priv    = event.extendedProperties?.private ?? {};
            const task_id = priv['gentask_taskId'];
            const list_id = priv['gentask_listId'];

            if (!task_id || !list_id) continue;

            const task_res = await tasks_client.tasks.get({
                tasklist: list_id,
                task:     task_id,
            });

            // Phase 9: 完了済みタスクはゾンビ化防止のためスキップ
            if (task_res.data.status === 'completed') {
                console.log(`  [Skip] Completed task skipped: ${task_res.data.title}`);
                continue;
            }

            const current_status = 0;
            list_map.set(task_id, list_id);

            sync_inputs.push({
                eventId:       event.id!,
                taskId:        task_id,
                listId:        list_id,
                subject:       event.summary ?? '',
                bodyContent:   event.description ?? '',
                currentStatus: current_status,
            });
        }

        // 3. AI で変化を解釈
        console.log('🤖 Analyzing changes with AI...');
        const actions = await sync_flow(sync_inputs);
        const active  = actions.filter(a => a.action !== 'no_change');
        console.log(`   ${active.length} action(s) to apply.`);

        // 4. Google Tasks に反映
        await sync_svc.apply_actions(actions, list_map);

        console.log(`\n✨ Sync complete. ${active.length} task(s) updated.`);
    } catch (error) {
        console.error('Fatal sync error:', error);
    }
}

const is_main = process.argv[1] === fileURLToPath(import.meta.url);
if (is_main) {
    // CLI 専用の副作用: 環境設定とバリデーションをエントリポイント内に限定
    const target_env = process.argv[2] || 'dev';
    dotenv.config({ path: `.env.${target_env}` });
    validate_env();
    main();
}
