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
import { create_oauth_client } from '../src/google';
import { google_container_manager } from '../src/google_container_manager';
import {
    task_schema,
    type bucket_role,
    type gen_task,
    decode_gentask_metadata,
    encode_gentask_metadata,
    strip_gentask_metadata,
    generate_gentask_uuid,
} from '../lib/types';
import { snapshot } from '../lib/snapshot';

const ai_engine = genkit({
    plugins: [googleAI({ apiKey: process.env.GCP_VERTEX_AI_API_KEY })],
    model: gemini20Flash,
});

// ─── 定数 ────────────────────────────────────────────────────────────────────

const MODES = ['PTASK', 'TTASK', 'CTASK', 'ATASK'] as const;

type SubRole = gen_task['sub_role'];

/**
 * spec §3 週間マトリクス：plot / name の Google Calendar 配置ルール（JST 時刻）
 * キーは sub_role enum 値（文字列一致ではない）。
 * day: 1=月, 2=火, 3=水, 4=木, 5=金
 * blocks: 1 ブロック = 30 分
 */
export const PLANNING_SCHEDULE: Partial<Record<SubRole, { day: number; hour: number; blocks: number }[]>> = {
    'plot': [
        { day: 3, hour: 14, blocks: 2 }, // 水 14:00〜15:00 (2×30min)
        { day: 4, hour: 14, blocks: 2 }, // 木 14:00〜15:00
    ],
    'name': [
        { day: 5, hour: 14, blocks: 2 }, // 金 14:00〜15:00
    ],
    // 'post' と 'other' はデフォルトスロット（翌月曜 09:00 から順次配置）
};

// ─── 型定義 ──────────────────────────────────────────────────────────────────

/**
 * @interface google_task_item
 * @description Google Tasks API から取得したタスクの必要最小構造。
 */
export interface google_task_item {
    id:       string;
    title:    string;
    notes?:   string;
    status:   'needsAction' | 'completed';
    due?:     string;
    list_id:  string;
    sub_role: SubRole; // タスクの工程ロール（デフォルト 'other'）
}

// ─── スケジュールユーティリティ ──────────────────────────────────────────────

// get_schedule_key は廃止 — sub_role による直接分岐に移行

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
async function get_tasks_in_list(list_id: string, auth: any): Promise<google_task_item[]> {
    const tasks_client = google.tasks({ version: 'v1', auth });
    const res = await tasks_client.tasks.list({
        tasklist:      list_id,
        showCompleted: false,
    });
    return (res.data.items ?? []).map(t => {
        const meta = decode_gentask_metadata(t.notes ?? undefined);
        return {
            id:       t.id!,
            title:    t.title ?? '',
            notes:    t.notes ?? undefined,
            status:   (t.status as 'needsAction' | 'completed') ?? 'needsAction',
            due:      t.due ?? undefined,
            list_id:  list_id,
            sub_role: (meta?.sub_role as SubRole) ?? 'other',
        };
    });
}

/**
 * @function move_task
 * @description タスクをソースリストからターゲットリストへ移動する。
 * Google Tasks にはネイティブな移動 API がないため、insert + delete で実現する。
 * 移動後もメタデータの uuid は不変に保たれ、listId を新しいリストに更新する。
 * Calendar の extendedProperties も新しい taskId / listId に patch する。
 * @param task           移動対象タスク
 * @param source_list_id 移動元リスト ID
 * @param target_list_id 移動先リスト ID
 * @param auth           Google OAuth2 クライアント
 * @param overrides      due の上書き値（オプション）
 * @returns 移動後の新しい GoogleTaskItem
 */
async function move_task(
    task: google_task_item,
    source_list_id: string,
    target_list_id: string,
    auth: any,
    overrides?: Partial<Pick<google_task_item, 'due'>>
): Promise<google_task_item> {
    const tasks_client = google.tasks({ version: 'v1', auth });

    // 既存メタデータを解析
    const existing_meta = decode_gentask_metadata(task.notes);
    const pure_notes    = strip_gentask_metadata(task.notes);

    // スナップショット保存（移動前の状態を uuid キーで保存）
    if (existing_meta) {
        snapshot.save(
            existing_meta.uuid,
            task.id,
            source_list_id,
            { status: task.status, due: task.due, notes: task.notes, list_id: source_list_id }
        );
    }

    // メタデータの list_id を移動先に更新して引き継ぐ
    const updated_meta = existing_meta
        ? encode_gentask_metadata({ ...existing_meta, list_id: target_list_id })
        : null;
    const new_notes = updated_meta
        ? (pure_notes ? `${pure_notes}\n${updated_meta}` : updated_meta)
        : task.notes;

    // 1. ターゲットリストに新規作成
    const inserted = await tasks_client.tasks.insert({
        tasklist: target_list_id,
        requestBody: {
            title:  task.title,
            notes:  new_notes,
            due:    overrides?.due ?? task.due,
            status: task.status,
        },
    });
    const new_task_id = inserted.data.id!;

    // 2. ソースリストから削除
    await tasks_client.tasks.delete({
        tasklist: source_list_id,
        task:     task.id,
    });

    // 3. Calendar の extendedProperties を新しい taskId / listId に更新（失敗してもログのみ）
    if (existing_meta) {
        const cal_client = google.calendar({ version: 'v3', auth });
        try {
            await cal_client.events.patch({
                calendarId: existing_meta.calendar_id,
                eventId:    existing_meta.event_id,
                requestBody: {
                    extendedProperties: {
                        private: {
                            gentask_uuid:   existing_meta.uuid,
                            gentask_taskId: new_task_id,
                            gentask_listId: target_list_id,
                        },
                    },
                },
            });
        } catch (err) {
            console.warn(`  [Move] Calendar 更新失敗 (uuid: ${existing_meta.uuid}):`, err);
        }
    }

    return {
        id:       new_task_id,
        title:    inserted.data.title ?? task.title,
        notes:    inserted.data.notes ?? undefined,
        status:   (inserted.data.status as 'needsAction' | 'completed') ?? 'needsAction',
        due:      inserted.data.due ?? undefined,
        list_id:  target_list_id,
        sub_role: task.sub_role,
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

    // CTASK のみ sub_role: 'post' タスクの完了を確認する
    if (mode === 'CTASK') {
        const post_task = tasks.find(t => t.sub_role === 'post');
        if (!post_task) {
            console.warn('  [Archive] sub_role: post のタスクが見つかりません。スライドをスキップします。');
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
): Promise<google_task_item[]> {
    const tasks = await get_tasks_in_list(container.next, auth);
    if (tasks.length === 0) {
        console.log('  [Promote] 来週分バケットにタスクがありません。');
        return [];
    }

    const next_monday = get_next_monday();
    const promoted: google_task_item[] = [];

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
    tasks: google_task_item[],
    auth: any
): Promise<void> {
    if (tasks.length === 0) return;

    const cal_client   = google.calendar({ version: 'v3', auth });
    const tasks_client = google.tasks({ version: 'v1', auth });
    const calendar_id  = process.env.GOOGLE_CALENDAR_ID!;
    const next_mon     = get_next_monday();

    let default_slot = new Date(next_mon);
    default_slot.setHours(9, 0, 0, 0);

    for (const task of tasks) {
        const schedule_slots = PLANNING_SCHEDULE[task.sub_role];

        if (schedule_slots && schedule_slots.length > 0) {
            // sub_role に対応するスロット（plot: 水・木、name: 金）に配置
            for (const slot of schedule_slots) {
                const slot_start = get_weekday_date(next_mon, slot.day);
                slot_start.setHours(slot.hour, 0, 0, 0);
                const slot_end = new Date(slot_start.getTime() + slot.blocks * 30 * 60_000);

                const event_res = await cal_client.events.insert({
                    calendarId: calendar_id,
                    requestBody: {
                        summary: task.title,
                        start:   { dateTime: slot_start.toISOString() },
                        end:     { dateTime: slot_end.toISOString() },
                        extendedProperties: {
                            private: {
                                gentask_uuid:   decode_gentask_metadata(task.notes)?.uuid ?? generate_gentask_uuid(),
                                gentask_taskId: task.id,
                                gentask_listId: task.list_id,
                            },
                        },
                    },
                });

                // タスクの notes に UUID 付き双方向リンクを書き込む
                const event_id     = event_res.data.id!;
                const existing_meta = decode_gentask_metadata(task.notes);
                const pure_notes   = strip_gentask_metadata(task.notes);
                const new_uuid     = existing_meta?.uuid ?? generate_gentask_uuid();
                const new_meta     = encode_gentask_metadata({
                    uuid:        new_uuid,
                    event_id:    event_id,
                    calendar_id: calendar_id,
                    list_id:     task.list_id,
                    sub_role:    task.sub_role,
                });
                await tasks_client.tasks.update({
                    tasklist: task.list_id,
                    task:     task.id,
                    requestBody: {
                        id:    task.id,
                        notes: pure_notes ? `${pure_notes}\n${new_meta}` : new_meta,
                    },
                });

                console.log(`  [Schedule] ${task.title} (${task.sub_role}) → ${slot_start.toISOString()}`);
            }
        } else {
            // 'post' と 'other': 翌月曜 09:00 から 30 分ブロックで順次配置
            const slot_end  = new Date(default_slot.getTime() + 30 * 60_000);
            const event_res = await cal_client.events.insert({
                calendarId: calendar_id,
                requestBody: {
                    summary: task.title,
                    start:   { dateTime: default_slot.toISOString() },
                    end:     { dateTime: slot_end.toISOString() },
                    extendedProperties: {
                        private: {
                            gentask_uuid:   decode_gentask_metadata(task.notes)?.uuid ?? generate_gentask_uuid(),
                            gentask_taskId: task.id,
                            gentask_listId: task.list_id,
                        },
                    },
                },
            });

            const event_id     = event_res.data.id!;
            const existing_meta = decode_gentask_metadata(task.notes);
            const pure_notes   = strip_gentask_metadata(task.notes);
            const new_uuid     = existing_meta?.uuid ?? generate_gentask_uuid();
            const new_meta     = encode_gentask_metadata({
                uuid:        new_uuid,
                event_id:    event_id,
                calendar_id: calendar_id,
                list_id:     task.list_id,
                sub_role:    task.sub_role,
            });
            await tasks_client.tasks.update({
                tasklist: task.list_id,
                task:     task.id,
                requestBody: {
                    id:    task.id,
                    notes: pure_notes ? `${pure_notes}\n${new_meta}` : new_meta,
                },
            });

            console.log(`  [Schedule] ${task.title} (${task.sub_role}) → ${default_slot.toISOString()}`);
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
各タスクは PTASK（企画・言語化）として、具体的で実行可能なタイトルと詳細を持つこと。
sub_role は必ず "plot" に設定すること（これらはすべてプロット作業タスクのため）。`,
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

        const auth    = create_oauth_client();
        const manager = new google_container_manager();

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
