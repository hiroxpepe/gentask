import { genkit, z } from 'genkit';
import { googleAI, gemini20Flash } from '@genkit-ai/googleai';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { validate_env } from '../lib/env';
import { graph } from '../lib/graph';
import { OutlookService } from '../lib/outlook';
import { task_schema } from '../lib/types';

// 環境設定
const target_env = process.argv[2] || 'dev';
dotenv.config({ path: `.env.${target_env}` });
validate_env();

const ai_engine = genkit({
    plugins: [googleAI({ apiKey: process.env.GCP_VERTEX_AI_API_KEY })],
    model: gemini20Flash,
});

// ─── 定数 ────────────────────────────────────────────────────────────────────

const MODES = ['PTASK', 'TTASK', 'CTASK', 'ATASK'] as const;
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** spec §3 週間マトリクス：プロット / ネーム の Outlook 配置ルール（JST 時刻） */
const PLANNING_SCHEDULE: Record<string, { day: number; hour: number; blocks: number }[]> = {
    'プロット': [
        { day: 3, hour: 14, blocks: 2 }, // 水 14:00〜15:00 (2×30min)
        { day: 4, hour: 14, blocks: 2 }, // 木 14:00〜15:00
    ],
    'ネーム': [
        { day: 5, hour: 14, blocks: 2 }, // 金 14:00〜15:00
    ],
};

/** タイトルから PLANNING_SCHEDULE キーを検索する */
function get_schedule_key(title: string): string | undefined {
    return Object.keys(PLANNING_SCHEDULE).find(k => title.includes(k));
}

// ─── Graph API ヘルパー ───────────────────────────────────────────────────────

// ─── 型定義 ────────────────────────────────────────────────────────────────────

export interface PlannerTask {
    id: string;
    title: string;
    bucketId: string;
    percentComplete: number;
    dueDateTime?: string;
    startDateTime?: string;
    '@odata.etag': string;
}

export interface PlannerBucket {
    id: string;
    name: string;
}

/** グループ内プランを列挙し、最新（createdDateTime 降順）のプランを返す */
export async function get_latest_plan(group_id: string): Promise<{ id: string; title: string } | null> {
    const res = await graph.get(`${GRAPH_BASE}/groups/${group_id}/planner/plans`);
    const plans = (res.value ?? []) as Array<{ id: string; title: string; createdDateTime: string }>;
    if (plans.length === 0) return null;
    plans.sort((a, b) => new Date(b.createdDateTime).getTime() - new Date(a.createdDateTime).getTime());
    return plans[0];
}

/** プラン内のバケットを名前→ID のマップで返す */
export async function get_buckets(plan_id: string): Promise<Map<string, string>> {
    const res = await graph.get(`${GRAPH_BASE}/planner/plans/${plan_id}/buckets`);
    const buckets = (res.value ?? []) as PlannerBucket[];
    return new Map(buckets.map(b => [b.name, b.id]));
}

/** バケット内タスクを全件返す */
export async function get_tasks_in_bucket(bucket_id: string): Promise<PlannerTask[]> {
    const res = await graph.get(`${GRAPH_BASE}/planner/buckets/${bucket_id}/tasks`);
    return (res.value ?? []) as PlannerTask[];
}

/** タスクの bucketId を変更してバケット間を移動する */
export async function move_task(task: PlannerTask, target_bucket_id: string): Promise<void> {
    await graph.patch(`${GRAPH_BASE}/planner/tasks/${task.id}`, {
        bucketId: target_bucket_id,
    }, { 'If-Match': task['@odata.etag'] });
}

// ─── T-15: 投稿完了チェック＋アーカイブ ────────────────────────────────────

/**
 * @function archive_current_week
 * @description 今週分バケットのタスクを完了バケットへ移動する。
 * 移動前に「投稿」タスク（spec §2 の締め切りタスク）の完了を確認する。
 * @returns 投稿タスクが完了していれば true、未完了なら false
 */
export async function archive_current_week(
    plan_id: string,
    buckets: Map<string, string>
): Promise<boolean> {
    const current_id = buckets.get('今週分');
    const done_id    = buckets.get('完了');
    if (!current_id || !done_id) {
        console.warn('  [Archive] バケット「今週分」または「完了」が見つかりません。スキップ。');
        return false;
    }

    const tasks = await get_tasks_in_bucket(current_id);

    // 投稿タスクの完了確認（タイトルに「投稿」を含むもの）
    const post_task = tasks.find(t => t.title.includes('投稿'));
    if (!post_task) {
        console.warn('  [Archive] 投稿タスクが見つかりません。スライドをスキップします。');
        return false;
    }
    if (post_task.percentComplete < 100) {
        console.warn(`  [Archive] 投稿タスク「${post_task.title}」が未完了 (${post_task.percentComplete}%)。スライドをスキップします。`);
        return false;
    }

    console.log(`  [Archive] 投稿タスク確認 ✅ — 今週分 ${tasks.length} 件をアーカイブ中...`);
    for (const task of tasks) {
        // 既に完了バケットにある場合はスキップ
        if (task.bucketId === done_id) continue;
        await move_task(task, done_id);
        console.log(`    → アーカイブ: ${task.title}`);
    }
    return true;
}

// ─── T-16: 来週分企画タスクの昇格 ───────────────────────────────────────────

/**
 * @function promote_next_week
 * @description 来週分バケットの企画タスク（PTASK）を今週分バケットへ移動し、
 * startDateTime を翌月曜（次の月曜日）に更新する。
 * @returns 昇格されたタスク一覧
 */
export async function promote_next_week(
    plan_id: string,
    buckets: Map<string, string>
): Promise<PlannerTask[]> {
    const next_id    = buckets.get('来週分');
    const current_id = buckets.get('今週分');
    if (!next_id || !current_id) {
        console.warn('  [Promote] バケットが見つかりません。スキップ。');
        return [];
    }

    const tasks = await get_tasks_in_bucket(next_id);
    if (tasks.length === 0) {
        console.log('  [Promote] 来週分バケットにタスクがありません。');
        return [];
    }

    // 翌月曜日 09:00 JST を算出
    const next_monday = get_next_monday();
    const promoted: PlannerTask[] = [];

    for (const task of tasks) {
        // 最新のタスク情報（etag 更新のため再取得）
        const fresh = await graph.get(`${GRAPH_BASE}/planner/tasks/${task.id}`) as PlannerTask;
        await graph.patch(`${GRAPH_BASE}/planner/tasks/${fresh.id}`, {
            bucketId:      current_id,
            startDateTime: next_monday.toISOString(),
        }, { 'If-Match': fresh['@odata.etag'] });

        promoted.push(task);
        console.log(`  [Promote] 昇格: ${task.title}`);
    }

    return promoted;
}

// ─── T-17: Outlook カレンダー自動配置 ───────────────────────────────────────

/**
 * @function schedule_promoted_tasks
 * @description 昇格タスクを spec §3 週間マトリクスに従い Outlook カレンダーへ配置する。
 * PLANNING_SCHEDULE でマッチするタスクは指定曜日/時刻に、それ以外は月曜 09:00 から順次配置。
 */
export async function schedule_promoted_tasks(tasks: PlannerTask[]): Promise<void> {
    const outlook   = new OutlookService();
    const next_mon  = get_next_monday();

    // 月曜 09:00 からの「デフォルト」スロットカーソル（マトリクス対象外タスク用）
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

                await outlook.create_event(
                    {
                        title:       task.title,
                        mode:        'PTASK',
                        priority:    5,
                        description: `[昇格タスク] ${task.title}`,
                        label:       'Green',
                    },
                    task.id,
                    slot_start.toISOString(),
                    slot_end.toISOString()
                );
                console.log(`  [Schedule] ${task.title} → ${slot_start.toISOString()}`);
            }
        } else {
            // デフォルト：月曜 09:00 から 30 分ブロックで順次配置
            const slot_end = new Date(default_slot.getTime() + 30 * 60_000);
            await outlook.create_event(
                {
                    title:       task.title,
                    mode:        'PTASK',
                    priority:    5,
                    description: `[昇格タスク] ${task.title}`,
                    label:       'Green',
                },
                task.id,
                default_slot.toISOString(),
                slot_end.toISOString()
            );
            console.log(`  [Schedule] ${task.title} → ${default_slot.toISOString()}`);
            default_slot = slot_end;
        }
    }
}

// ─── T-18: 次々回プロット生成 ────────────────────────────────────────────────

/**
 * @function generate_next_plot
 * @description 次々回話数のプロットタスク 4 ブロック（PTASK）を AI で生成し、
 * 来週分バケットに配置する。
 */
export async function generate_next_plot(
    plan_id: string,
    buckets: Map<string, string>,
    episode_hint: string
): Promise<void> {
    const next_id = buckets.get('来週分');
    if (!next_id) {
        console.warn('  [Generate] 来週分バケットが見つかりません。スキップ。');
        return;
    }

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

    // 来週分バケットに直接 POST
    const m365_user_id = process.env.M365_USER_ID;
    for (const task of output.slice(0, 4)) {
        await graph.post(`${GRAPH_BASE}/planner/tasks`, {
            planId:   plan_id,
            bucketId: next_id,
            title:    task.title,
            priority: task.priority,
            assignments: {
                [m365_user_id!]: {
                    '@odata.type': '#microsoft.graph.plannerAssignment',
                    orderHint: ' !',
                }
            },
        });
        console.log(`  [Generate] 生成: ${task.title}`);
    }
}

// ─── 日付ユーティリティ ───────────────────────────────────────────────────────

/** 次の月曜日 00:00:00 JST を返す */
export function get_next_monday(): Date {
    const now  = new Date();
    const day  = now.getDay(); // 0=日, 1=月 ... 6=土
    const diff = day === 0 ? 1 : 8 - day; // 日曜なら翌月曜、それ以外は次の月曜
    const next = new Date(now);
    next.setDate(now.getDate() + diff);
    next.setHours(0, 0, 0, 0);
    return next;
}

/** 翌週の指定曜日（0=日〜6=土）の Date を返す */
export function get_weekday_date(base_monday: Date, target_day: number): Date {
    const d = new Date(base_monday);
    d.setDate(base_monday.getDate() + (target_day - 1)); // base_monday は月曜(1)
    return d;
}

// ─── エントリポイント ─────────────────────────────────────────────────────────

/**
 * @description slide コマンドのエントリポイント。
 * 全モードのプランに対して投稿完了確認 → アーカイブ → 昇格 → スケジュール → 次週生成 を実行する。
 * 第3引数に次エピソードのヒントを渡す（例: npm run slide:dev -- "第42話 クライマックス編"）
 */
const is_main = process.argv[1] === fileURLToPath(import.meta.url);
if (is_main) {
(async () => {
    const episode_hint = process.argv.slice(3).join(' ') || '次エピソード';

    try {
        console.log('🗓️  Gentask Weekly Slide 開始...\n');

        for (const mode of MODES) {
            const group_id = process.env[`M365_PLANNER_${mode}_GROUP_ID`];
            if (!group_id) {
                console.log(`  [Skip] ${mode}: 環境変数未設定`);
                continue;
            }

            const plan = await get_latest_plan(group_id);
            if (!plan) {
                console.log(`  [Skip] ${mode}: プランが見つかりません`);
                continue;
            }

            console.log(`\n📋 ${mode} — プラン: ${plan.title}`);
            const buckets = await get_buckets(plan.id);

            // T-15: 投稿完了チェック＋アーカイブ
            const archived = await archive_current_week(plan.id, buckets);
            if (!archived) continue; // 投稿未完了ならこのモードはスキップ

            // T-16: 来週分 → 今週分 昇格
            const promoted = await promote_next_week(plan.id, buckets);

            // T-17: 昇格タスクを Outlook カレンダーに配置
            if (promoted.length > 0) {
                console.log(`\n  📅 Outlook へ ${promoted.length} 件の予定を作成中...`);
                await schedule_promoted_tasks(promoted);
            }

            // T-18: 来週分バケットに次々回プロットを生成（PTASK のみ）
            if (mode === 'PTASK') {
                await generate_next_plot(plan.id, buckets, episode_hint);
            }
        }

        console.log('\n✨ Weekly Slide 完了。');
    } catch (error) {
        console.error('Fatal slide error:', error);
    }
})();
}
