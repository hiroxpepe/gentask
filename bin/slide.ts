/**
 * @file bin/slide.ts
 * @description 週次スライド処理のエントリポイント。
 * 各モード（PTASK/TTASK/CTASK/ATASK）に対して:
 *   1. 今週分タスクをアーカイブ（CTASK は投稿完了チェックあり）
 *   2. 来週分タスクを今週分に昇格
 *   3. 昇格タスクを Google Calendar に配置
 *   4. PTASK のみ次々回プロットを AI 生成
 */
import { genkit, z } from 'genkit';
import { googleAI, gemini20Flash } from '@genkit-ai/googleai';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { validate_env } from '../lib/env';
import { google } from 'googleapis';
import { createOAuthClient } from '../src/google';
import { GoogleContainerManager } from '../src/google-container-manager';
import { task_schema, type bucket_role } from '../lib/types';

const ai_engine = genkit({
    plugins: [googleAI({ apiKey: process.env.GCP_VERTEX_AI_API_KEY })],
    model: gemini20Flash,
});

// ─── 定数 ────────────────────────────────────────────────────────────────────

const MODES = ['PTASK', 'TTASK', 'CTASK', 'ATASK'] as const;

/**
 * spec §3 週間マトリクス：プロット / ネーム の Google Calendar 配置ルール（JST 時刻）
 * day: 1=月, 2=火, 3=水, 4=木, 5=金
 * blocks: 1 ブロック = 30 分
 */
export const PLANNING_SCHEDULE: Record<string, { day: number; hour: number; blocks: number }[]> = {
    'プロット': [
        { day: 3, hour: 14, blocks: 2 }, // 水 14:00〜15:00 (2×30min)
        { day: 4, hour: 14, blocks: 2 }, // 木 14:00〜15:00
    ],
    'ネーム': [
        { day: 5, hour: 14, blocks: 2 }, // 金 14:00〜15:00
    ],
};

// ─── 型定義 ──────────────────────────────────────────────────────────────────

/**
 * @interface GoogleTaskItem
 * @description Google Tasks API から取得したタスクの必要最小構造。
 */
export interface GoogleTaskItem {
    id:      string;
    title:   string;
    notes?:  string;
    status:  'needsAction' | 'completed';
    due?:    string;
    listId:  string;
}

// ─── スケジュールユーティリティ ──────────────────────────────────────────────

/**
 * @function get_schedule_key
 * @description タイトルから PLANNING_SCHEDULE のキーを検索して返す。
 * @param title タスクタイトル
 * @returns マッチしたスケジュールキー、または undefined
 */
function get_schedule_key(title: string): string | undefined {
    return Object.keys(PLANNING_SCHEDULE).find(k => title.includes(k));
}

// ─── 日付ユーティリティ ───────────────────────────────────────────────────────

/**
 * @function get_next_monday
 * @description 次の月曜日 00:00:00 (ローカルタイム) を返す。
 * 現在が月曜の場合は翌週月曜を返す。
 * @returns 翌月曜日の Date オブジェクト
 */
export function get_next_monday(): Date {
    const now  = new Date();
    const day  = now.getDay(); // 0=日, 1=月 ... 6=土
    const diff = day === 0 ? 1 : 8 - day; // 日曜なら翌月曜、それ以外は次の月曜
    const next = new Date(now);
    next.setDate(now.getDate() + diff);
    next.setHours(0, 0, 0, 0);
    return next;
}

/**
 * @function get_weekday_date
 * @description 翌週の指定曜日（1=月〜7=日）の Date を返す。
 * base_monday を月曜(1) として offset を加算する。
 * @param base_monday 基準となる月曜日の Date
 * @param target_day  目標曜日（1=月, 2=火, ... 7=日）
 * @returns 該当日の Date オブジェクト
 */
export function get_weekday_date(base_monday: Date, target_day: number): Date {
    const d = new Date(base_monday);
    d.setDate(base_monday.getDate() + (target_day - 1)); // base_monday は月曜(1)
    return d;
}

// ─── Google Tasks ヘルパー ────────────────────────────────────────────────────

/**
 * @function get_tasks_in_list
 * @description 指定 Google Tasks リスト内のタスクを全件取得する（完了済みを含む）。
 * @param list_id Google Tasks リスト ID
 * @param auth    Google OAuth2 クライアント
 * @returns GoogleTaskItem の配列
 */
async function get_tasks_in_list(list_id: string, auth: any): Promise<GoogleTaskItem[]> {
    const tasks_client = google.tasks({ version: 'v1', auth });
    const res = await tasks_client.tasks.list({
        tasklist:      list_id,
        showCompleted: false,
    });
    return (res.data.items ?? []).map(t => ({
        id:     t.id!,
        title:  t.title ?? '',
        notes:  t.notes ?? undefined,
        status: (t.status as 'needsAction' | 'completed') ?? 'needsAction',
        due:    t.due ?? undefined,
        listId: list_id,
    }));
}

/**
 * @function move_task
 * @description タスクをソースリストからターゲットリストへ移動する。
 * Google Tasks にはネイティブな移動 API がないため、insert + delete で実現する。
 * 移動によってタスク ID が変わることに注意。
 * @param task           移動対象タスク
 * @param source_list_id 移動元リスト ID
 * @param target_list_id 移動先リスト ID
 * @param auth           Google OAuth2 クライアント
 * @param overrides      due / notes の上書き値（オプション）
 * @returns 移動後の新しい GoogleTaskItem
 */
async function move_task(
    task: GoogleTaskItem,
    source_list_id: string,
    target_list_id: string,
    auth: any,
    overrides?: Partial<Pick<GoogleTaskItem, 'due' | 'notes'>>
): Promise<GoogleTaskItem> {
    const tasks_client = google.tasks({ version: 'v1', auth });

    const inserted = await tasks_client.tasks.insert({
        tasklist: target_list_id,
        requestBody: {
            title:  task.title,
            notes:  overrides?.notes ?? task.notes,
            due:    overrides?.due   ?? task.due,
            status: task.status,
        },
    });

    await tasks_client.tasks.delete({
        tasklist: source_list_id,
        task:     task.id,
    });

    return {
        id:     inserted.data.id!,
        title:  inserted.data.title ?? task.title,
        notes:  inserted.data.notes ?? undefined,
        status: (inserted.data.status as 'needsAction' | 'completed') ?? 'needsAction',
        due:    inserted.data.due ?? undefined,
        listId: target_list_id,
    };
}

// ─── T-15: 投稿完了チェック＋アーカイブ ────────────────────────────────────

/**
 * @function archive_current_week
 * @description 今週分リストのタスクを完了リストへ移動する。
 * CTASK のみ「投稿」タスクの完了を確認する（未完了ならアーカイブをスキップ）。
 * @param container バケットロール → リスト ID のマップ
 * @param auth      Google OAuth2 クライアント
 * @param mode      タスクモード（CTASK の場合は投稿チェックを行う）
 * @returns アーカイブを実行した場合は true、スキップした場合は false
 */
export async function archive_current_week(
    container: Record<bucket_role, string>,
    auth: any,
    mode: string
): Promise<boolean> {
    const tasks = await get_tasks_in_list(container.current, auth);

    // CTASK のみ「投稿」タスクの完了を確認する
    if (mode === 'CTASK') {
        const post_task = tasks.find(t => t.title.includes('投稿'));
        if (!post_task) {
            console.warn('  [Archive] 投稿タスクが見つかりません。スライドをスキップします。');
            return false;
        }
        if (post_task.status !== 'completed') {
            console.warn(`  [Archive] 投稿タスク「${post_task.title}」が未完了。スライドをスキップします。`);
            return false;
        }
    }

    console.log(`  [Archive] 今週分 ${tasks.length} 件をアーカイブ中...`);
    for (const task of tasks) {
        await move_task(task, container.current, container.done, auth);
        console.log(`    → アーカイブ: ${task.title}`);
    }
    return true;
}

// ─── T-16: 来週分企画タスクの昇格 ───────────────────────────────────────────

/**
 * @function promote_next_week
 * @description 来週分リストのタスクを今週分リストへ移動し、due を翌月曜に設定する。
 * @param container バケットロール → リスト ID のマップ
 * @param auth      Google OAuth2 クライアント
 * @returns 昇格された GoogleTaskItem の配列
 */
export async function promote_next_week(
    container: Record<bucket_role, string>,
    auth: any
): Promise<GoogleTaskItem[]> {
    const tasks = await get_tasks_in_list(container.next, auth);
    if (tasks.length === 0) {
        console.log('  [Promote] 来週分バケットにタスクがありません。');
        return [];
    }

    const next_monday = get_next_monday();
    const promoted: GoogleTaskItem[] = [];

    for (const task of tasks) {
        const new_task = await move_task(
            task,
            container.next,
            container.current,
            auth,
            { due: next_monday.toISOString() }
        );
        promoted.push(new_task);
        console.log(`  [Promote] 昇格: ${task.title}`);
    }
    return promoted;
}

// ─── T-17: Google Calendar 自動配置 ─────────────────────────────────────────

/**
 * @function schedule_promoted_tasks
 * @description 昇格タスクを spec §3 週間マトリクスに従い Google Calendar へ配置する。
 * PLANNING_SCHEDULE でマッチするタスクは指定曜日/時刻に、それ以外は月曜 09:00 から順次配置。
 * 配置後、タスクの notes に双方向リンクを追記する。
 * @param tasks 昇格タスクの一覧
 * @param auth  Google OAuth2 クライアント
 */
export async function schedule_promoted_tasks(
    tasks: GoogleTaskItem[],
    auth: any
): Promise<void> {
    if (tasks.length === 0) return;

    const cal_client    = google.calendar({ version: 'v3', auth });
    const tasks_client  = google.tasks({ version: 'v1', auth });
    const calendar_id   = process.env.GOOGLE_CALENDAR_ID!;
    const next_mon      = get_next_monday();

    let default_slot = new Date(next_mon);
    default_slot.setHours(9, 0, 0, 0);

    for (const task of tasks) {
        const schedule_key = get_schedule_key(task.title);

        if (schedule_key) {
            // マトリクス対応タスク：指定曜日×ブロック数で配置
            for (const slot of PLANNING_SCHEDULE[schedule_key]) {
                const slot_start = get_weekday_date(next_mon, slot.day);
                slot_start.setHours(slot.hour, 0, 0, 0);
                const slot_end = new Date(slot_start.getTime() + slot.blocks * 30 * 60_000);

                const event_res = await cal_client.events.insert({
                    calendarId: calendar_id,
                    requestBody: {
                        summary:     task.title,
                        start:       { dateTime: slot_start.toISOString() },
                        end:         { dateTime: slot_end.toISOString() },
                        extendedProperties: {
                            private: {
                                gentask_taskId: task.id,
                                gentask_listId: task.listId,
                            },
                        },
                    },
                });

                // タスクの notes に双方向リンクを追記
                const event_id   = event_res.data.id!;
                const prev_notes = task.notes ?? '';
                await tasks_client.tasks.update({
                    tasklist: task.listId,
                    task:     task.id,
                    requestBody: {
                        id:    task.id,
                        notes: `${prev_notes}\n[gentask:{"eventId":"${event_id}","calendarId":"${calendar_id}","listId":"${task.listId}"}]`,
                    },
                });

                console.log(`  [Schedule] ${task.title} → ${slot_start.toISOString()}`);
            }
        } else {
            // デフォルト：月曜 09:00 から 30 分ブロックで順次配置
            const slot_end = new Date(default_slot.getTime() + 30 * 60_000);
            const event_res = await cal_client.events.insert({
                calendarId: calendar_id,
                requestBody: {
                    summary:     task.title,
                    start:       { dateTime: default_slot.toISOString() },
                    end:         { dateTime: slot_end.toISOString() },
                    extendedProperties: {
                        private: {
                            gentask_taskId: task.id,
                            gentask_listId: task.listId,
                        },
                    },
                },
            });

            const event_id   = event_res.data.id!;
            const prev_notes = task.notes ?? '';
            await tasks_client.tasks.update({
                tasklist: task.listId,
                task:     task.id,
                requestBody: {
                    id:    task.id,
                    notes: `${prev_notes}\n[gentask:{"eventId":"${event_id}","calendarId":"${calendar_id}","listId":"${task.listId}"}]`,
                },
            });

            console.log(`  [Schedule] ${task.title} → ${default_slot.toISOString()}`);
            default_slot = slot_end;
        }
    }
}

// ─── T-18: 次々回プロット生成 ────────────────────────────────────────────────

/**
 * @function generate_next_plot
 * @description 次々回話数のプロットタスク 4 ブロック（PTASK）を AI で生成し、
 * 来週分リストに配置する。
 * @param container    バケットロール → リスト ID のマップ
 * @param episode_hint 次回エピソードのヒント文字列
 * @param auth         Google OAuth2 クライアント
 */
export async function generate_next_plot(
    container: Record<bucket_role, string>,
    episode_hint: string,
    auth: any
): Promise<void> {
    console.log(`  [Generate] 次々回プロット生成中... (${episode_hint})`);

    const { output } = await ai_engine.generate({
        prompt: `あなたは週刊漫画の連載管理AIです。「${episode_hint}」の次回エピソードのプロット作業を
4つの 0.5sp（30分）タスクに分解してください。
各タスクは PTASK（企画・言語化）として、具体的で実行可能なタイトルと詳細を持つこと。`,
        output: { schema: z.array(task_schema) },
    });

    if (!output || output.length === 0) {
        console.warn('  [Generate] AI がタスクを生成できませんでした。');
        return;
    }

    const tasks_client = google.tasks({ version: 'v1', auth });

    for (const task of output.slice(0, 4)) {
        await tasks_client.tasks.insert({
            tasklist: container.next,
            requestBody: {
                title: task.title,
                notes: task.description,
            },
        });
        console.log(`  [Generate] 生成: ${task.title}`);
    }
}

// ─── エントリポイント ─────────────────────────────────────────────────────────

const is_main = process.argv[1] === fileURLToPath(import.meta.url);
if (is_main) {
    // CLI 専用の副作用: 環境設定とバリデーションをエントリポイント内に限定
    const target_env = process.argv[2] || 'dev';
    dotenv.config({ path: `.env.${target_env}` });
    validate_env();

(async () => {
    const episode_hint = process.argv.slice(3).join(' ') || '次エピソード';

    try {
        console.log('🗓️  Gentask Weekly Slide 開始...\n');

        const auth    = createOAuthClient();
        const manager = new GoogleContainerManager();

        for (const mode of MODES) {
            console.log(`\n📋 ${mode}`);
            const container = await manager.get_container(mode, auth);

            const archived = await archive_current_week(container, auth, mode);
            if (!archived) continue;

            const promoted = await promote_next_week(container, auth);

            if (promoted.length > 0) {
                console.log(`\n  📅 Google Calendar へ ${promoted.length} 件の予定を作成中...`);
                await schedule_promoted_tasks(promoted, auth);
            }

            if (mode === 'PTASK') {
                await generate_next_plot(container, episode_hint, auth);
            }
        }

        console.log('\n✨ Weekly Slide 完了。');
    } catch (error) {
        console.error('Fatal slide error:', error);
    }
})();
}
