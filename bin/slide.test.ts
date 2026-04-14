/**
 * @file bin/slide.test.ts
 * @description slide.ts の単体テスト。
 * googleapis と genkit をモックして、各関数の動作を検証する。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── vi.hoisted でモック関数を宣言 ───────────────────────────────────────────

const {
    mock_tasks_list,
    mock_tasks_insert,
    mock_tasks_delete,
    mock_tasks_update,
    mock_cal_insert,
    mock_generate,
    mock_snapshot_save,
} = vi.hoisted(() => ({
    mock_tasks_list:    vi.fn(),
    mock_tasks_insert:  vi.fn(),
    mock_tasks_delete:  vi.fn(),
    mock_tasks_update:  vi.fn(),
    mock_cal_insert:    vi.fn(),
    mock_generate:      vi.fn(),
    mock_snapshot_save: vi.fn(),
}));

// ─── モック設定 ───────────────────────────────────────────────────────────────

vi.mock('googleapis', () => ({
    google: {
        auth:  { OAuth2: class { setCredentials() {} } },
        tasks: vi.fn(() => ({
            tasks: {
                list:   mock_tasks_list,
                insert: mock_tasks_insert,
                delete: mock_tasks_delete,
                update: mock_tasks_update,
            },
        })),
        calendar: vi.fn(() => ({
            events: { insert: mock_cal_insert },
        })),
    },
}));

vi.mock('../src/google', () => ({ create_oauth_client: vi.fn(() => ({})) }));
vi.mock('../lib/snapshot', () => ({ snapshot: { save: mock_snapshot_save, restore: vi.fn() } }));

vi.mock('genkit', async () => {
    const zod = await import('zod');
    return {
        genkit: vi.fn(() => ({
            defineFlow: vi.fn((_def: unknown, fn: unknown) => fn),
            generate:   mock_generate,
        })),
        z: zod.z,
    };
});

vi.mock('@genkit-ai/googleai', () => ({
    googleAI:      vi.fn(() => ({})),
    gemini20Flash: 'gemini-2.0-flash',
}));

// ─── テスト対象 ───────────────────────────────────────────────────────────────

import {
    get_next_monday,
    get_weekday_date,
    archive_current_week,
    promote_next_week,
    schedule_promoted_tasks,
    generate_next_plot,
    type google_task_item,
} from './slide';

/**
 * テスト用のメタデータ埋め込み notes を生成する。
 * @param sub_role タスクの工程ロール
 * @param list_id  タスクのリスト ID
 */
function make_meta_notes(sub_role: string, list_id = 'list-current'): string {
    return `[gentask:{"uuid":"test-uuid-${sub_role}","event_id":"evt-1","calendar_id":"cal-1","list_id":"${list_id}","sub_role":"${sub_role}"}]`;
}

/**
 * google_task_item のファクトリ関数。テスト用にデフォルト値付きで生成する。
 */
function make_task(
    id: string,
    title: string,
    list_id: string,
    status: 'needsAction' | 'completed' = 'needsAction',
    sub_role: google_task_item['sub_role'] = 'other',
    notes?: string
): google_task_item {
    return { id, title, list_id, status, sub_role, notes };
}

// ─── get_next_monday テスト ───────────────────────────────────────────────────

describe('get_next_monday', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('月曜日に実行すると翌週の月曜日を返す', () => {
        // 2026-03-30 は月曜日
        vi.setSystemTime(new Date('2026-03-30T10:00:00Z'));
        const result = get_next_monday();
        expect(result.getDay()).toBe(1); // 月曜
        expect(result.getDate()).toBe(6);
        expect(result.getMonth()).toBe(3); // 4月 (0-indexed)
    });

    it('日曜日に実行すると翌日（月曜）を返す', () => {
        // 2026-04-05 は日曜日
        vi.setSystemTime(new Date('2026-04-05T10:00:00Z'));
        const result = get_next_monday();
        expect(result.getDay()).toBe(1); // 月曜
    });

    it('金曜日に実行すると翌週月曜を返す', () => {
        // 2026-04-03 は金曜日
        vi.setSystemTime(new Date('2026-04-03T10:00:00Z'));
        const result = get_next_monday();
        expect(result.getDay()).toBe(1);
    });
});

// ─── get_weekday_date テスト ─────────────────────────────────────────────────

describe('get_weekday_date', () => {
    it('月曜(base) + 3日 = 水曜', () => {
        const monday = new Date('2026-04-06T00:00:00.000Z');
        const wed = get_weekday_date(monday, 3);
        expect(wed.getDate()).toBe(8); // 04-08 = 水曜
    });

    it('月曜(base) + 1日 = 月曜', () => {
        const monday = new Date('2026-04-06T00:00:00.000Z');
        const same_monday = get_weekday_date(monday, 1);
        expect(same_monday.getDate()).toBe(6);
    });
});

// ─── archive_current_week テスト ─────────────────────────────────────────────

describe('archive_current_week', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const CONTAINER = { current: 'list-current', next: 'list-next', done: 'list-done' };

    it('CTASK: 投稿タスクが完了済みなら true を返して全タスクを移動する', async () => {
        const post_notes = make_meta_notes('post');
        mock_tasks_list.mockResolvedValue({ data: { items: [
            { id: 't1', title: 'エディット作業', status: 'needsAction' },
            { id: 't2', title: '投稿', status: 'completed', notes: post_notes },
        ] } });
        mock_tasks_insert.mockResolvedValue({ data: { id: 'new-id', title: 'dummy', status: 'needsAction' } });
        mock_tasks_delete.mockResolvedValue({});

        const result = await archive_current_week(CONTAINER, {}, 'CTASK');

        expect(result).toBe(true);
        expect(mock_tasks_insert).toHaveBeenCalledTimes(2);
        expect(mock_tasks_delete).toHaveBeenCalledTimes(2);
    });

    it('CTASK: 投稿タスクが未完了なら false を返して移動しない', async () => {
        const post_notes = make_meta_notes('post');
        mock_tasks_list.mockResolvedValue({ data: { items: [
            { id: 't1', title: 'エディット作業', status: 'needsAction' },
            { id: 't2', title: '投稿', status: 'needsAction', notes: post_notes },
        ] } });

        const result = await archive_current_week(CONTAINER, {}, 'CTASK');

        expect(result).toBe(false);
        expect(mock_tasks_insert).not.toHaveBeenCalled();
    });

    it('CTASK: 投稿タスクが存在しない場合は false を返す', async () => {
        mock_tasks_list.mockResolvedValue({ data: { items: [
            { id: 't1', title: 'エディット', status: 'needsAction' },
        ] } });

        const result = await archive_current_week(CONTAINER, {}, 'CTASK');
        expect(result).toBe(false);
    });

    it('PTASK（非CTASK）: 投稿タスクがなくてもアーカイブが進み true を返す', async () => {
        mock_tasks_list.mockResolvedValue({ data: { items: [
            { id: 't1', title: 'プロット作成', status: 'needsAction' },
        ] } });
        mock_tasks_insert.mockResolvedValue({ data: { id: 'new-id', title: 'dummy', status: 'needsAction' } });
        mock_tasks_delete.mockResolvedValue({});

        const result = await archive_current_week(CONTAINER, {}, 'PTASK');
        expect(result).toBe(true);
        expect(mock_tasks_insert).toHaveBeenCalledTimes(1);
    });

    it('タスクが0件の場合は true を返す（CTASK のチェック対象なし）', async () => {
        mock_tasks_list.mockResolvedValue({ data: { items: [] } });

        const result = await archive_current_week(CONTAINER, {}, 'PTASK');
        expect(result).toBe(true);
    });
});

// ─── promote_next_week テスト ─────────────────────────────────────────────────

describe('promote_next_week', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.setSystemTime(new Date('2026-03-30T10:00:00Z')); // 月曜
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const CONTAINER = { current: 'list-current', next: 'list-next', done: 'list-done' };

    it('来週分にタスクあり → 移動して昇格タスク一覧を返す', async () => {
        const tasks = [
            { id: 't1', title: 'プロット第42話', status: 'needsAction' },
            { id: 't2', title: 'ラフネーム', status: 'needsAction' },
        ];
        mock_tasks_list.mockResolvedValue({ data: { items: tasks } });
        mock_tasks_insert
            .mockResolvedValueOnce({ data: { id: 'new-t1', title: 'プロット第42話', status: 'needsAction' } })
            .mockResolvedValueOnce({ data: { id: 'new-t2', title: 'ラフネーム', status: 'needsAction' } });
        mock_tasks_delete.mockResolvedValue({});

        const promoted = await promote_next_week(CONTAINER, {});

        expect(promoted).toHaveLength(2);
        expect(mock_tasks_delete).toHaveBeenCalledTimes(2);
    });

    it('来週分が空の場合は空配列を返す', async () => {
        mock_tasks_list.mockResolvedValue({ data: { items: [] } });

        const promoted = await promote_next_week(CONTAINER, {});
        expect(promoted).toHaveLength(0);
        expect(mock_tasks_insert).not.toHaveBeenCalled();
    });

    it('昇格されたタスクの due が翌月曜に設定される', async () => {
        const tasks = [{ id: 't1', title: 'タスク', status: 'needsAction' }];
        mock_tasks_list.mockResolvedValue({ data: { items: tasks } });
        mock_tasks_insert.mockResolvedValue({ data: { id: 'new-t1', title: 'タスク', status: 'needsAction' } });
        mock_tasks_delete.mockResolvedValue({});

        await promote_next_week(CONTAINER, {});

        const insert_call = mock_tasks_insert.mock.calls[0][0] as any;
        const due_date = new Date(insert_call.requestBody.due);
        // 2026-03-30 月曜 → 翌月曜 = 2026-04-06
        expect(due_date.getDay()).toBe(1);
        expect(due_date.getDate()).toBe(6);
    });
});

// ─── schedule_promoted_tasks テスト ─────────────────────────────────────────

describe('schedule_promoted_tasks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // 2026-03-30 (月) 10:00 JST (01:00 UTC)
        vi.setSystemTime(new Date('2026-03-30T01:00:00Z'));
        process.env.GOOGLE_CALENDAR_ID = 'cal-001';
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('sub_role: plot のタスク → 水・木の 2 イベントが作成される', async () => {
        mock_cal_insert.mockResolvedValue({ data: { id: 'event-1' } });
        mock_tasks_update.mockResolvedValue({ data: {} });

        const tasks = [make_task('t1', '第42話のプロット作成', 'list-c', 'needsAction', 'plot')];
        await schedule_promoted_tasks(tasks, {});

        expect(mock_cal_insert).toHaveBeenCalledTimes(2); // 水, 木
    });

    it('sub_role: other のタスク → 月曜 09:00 から順次配置', async () => {
        mock_cal_insert
            .mockResolvedValueOnce({ data: { id: 'event-1' } })
            .mockResolvedValueOnce({ data: { id: 'event-2' } });
        mock_tasks_update.mockResolvedValue({ data: {} });

        const tasks = [
            make_task('t1', '背景資料集め', 'list-c'),
            make_task('t2', 'キャラクターデザイン', 'list-c'),
        ];
        await schedule_promoted_tasks(tasks, {});

        expect(mock_cal_insert).toHaveBeenCalledTimes(2);
        const first_call = mock_cal_insert.mock.calls[0][0] as any;
        const second_call = mock_cal_insert.mock.calls[1][0] as any;
        const start1 = new Date(first_call.requestBody.start.dateTime);
        const end1   = new Date(first_call.requestBody.end.dateTime);
        const start2 = new Date(second_call.requestBody.start.dateTime);
        // 2回目は1回目の終了と同じ時刻から始まる
        expect(start2.getTime()).toBe(end1.getTime());
        // 月曜 09:00 JST = 00:00 UTC
        expect(start1.getUTCDay()).toBe(1); // 月曜
        expect(start1.getUTCHours()).toBe(0);
    });

    it('タスクが空の場合はカレンダー API が呼ばれない', async () => {
        await schedule_promoted_tasks([], {});
        expect(mock_cal_insert).not.toHaveBeenCalled();
    });
});

// ─── generate_next_plot テスト ───────────────────────────────────────────────

describe('generate_next_plot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const CONTAINER = { current: 'list-current', next: 'list-next', done: 'list-done' };

    it('AI がタスク生成 → tasks.insert が呼ばれる', async () => {
        const ai_tasks = [
            { title: 'プロット案出し', priority: 3, description: 'desc', label: 'Pink', mode: 'PTASK' },
            { title: '構成検討', priority: 5, description: 'desc', label: 'Pink', mode: 'PTASK' },
        ];
        mock_generate.mockResolvedValue({ output: ai_tasks });
        mock_tasks_insert.mockResolvedValue({ data: { id: 'new-task' } });

        await generate_next_plot(CONTAINER, '第43話', {});

        expect(mock_generate).toHaveBeenCalledOnce();
        expect(mock_generate.mock.calls[0][0].prompt).toContain('第43話');
        expect(mock_tasks_insert).toHaveBeenCalledTimes(2);
        expect(mock_tasks_insert.mock.calls[0][0].tasklist).toBe('list-next');
    });

    it('AI が null 返却 → tasks.insert が呼ばれない', async () => {
        mock_generate.mockResolvedValue({ output: null });

        await generate_next_plot(CONTAINER, '第43話', {});
        expect(mock_tasks_insert).not.toHaveBeenCalled();
    });
});
