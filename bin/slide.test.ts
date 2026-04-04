import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mocks for functions that are used across different mocks or tests
const { mock_create_event, mock_generate } = vi.hoisted(() => ({
    mock_create_event: vi.fn().mockResolvedValue('outlook-event-mock'),
    mock_generate:     vi.fn(),
}));

vi.mock('../lib/graph', () => ({
    graph: {
        post:  vi.fn(),
        get:   vi.fn(),
        patch: vi.fn(),
    },
}));

vi.mock('../lib/outlook', () => ({
    OutlookService: class {
        create_event = mock_create_event;
    },
}));

// genkit mock now uses the hoisted mock_generate
vi.mock('genkit', async () => {
    const zod = await import('zod');
    return {
        genkit: vi.fn(() => ({
            defineFlow: vi.fn((_def, fn) => fn),
            generate:   mock_generate,
        })),
        z: zod.z,
    };
});

vi.mock('@genkit-ai/googleai', () => ({
    googleAI:      vi.fn(() => ({})),
    gemini20Flash: 'gemini-2.0-flash',
}));

import { graph } from '../lib/graph';
// OutlookService is imported to ensure mocks are loaded, but not used directly
import { OutlookService } from '../lib/outlook';
import {
    get_next_monday,
    get_weekday_date,
    archive_current_week,
    promote_next_week,
    get_latest_plan,
    schedule_promoted_tasks,
    generate_next_plot,
    type PlannerTask,
} from './slide';

const mock_get   = graph.get   as ReturnType<typeof vi.fn>;
const mock_patch = graph.patch as ReturnType<typeof vi.fn>;
const mock_post  = graph.post  as ReturnType<typeof vi.fn>;


// ─── 純粋関数テスト ─────────────────────────────────────────────────────────

describe('get_next_monday', () => {
    it('月曜日に実行すると翌週の月曜日を返す', () => {
        // 2026-03-30 は月曜日
        vi.setSystemTime(new Date('2026-03-30T10:00:00Z'));
        const result = get_next_monday();
        // 翌月曜 = 2026-04-06
        expect(result.getDay()).toBe(1); // 月曜
        expect(result.getDate()).toBe(6);
        expect(result.getMonth()).toBe(3); // 4月 (0-indexed)
        vi.useRealTimers();
    });

    it('日曜日に実行すると翌日（月曜）を返す', () => {
        // 2026-04-05 は日曜日
        vi.setSystemTime(new Date('2026-04-05T10:00:00Z'));
        const result = get_next_monday();
        expect(result.getDay()).toBe(1); // 月曜
        vi.useRealTimers();
    });

    it('金曜日に実行すると翌週月曜を返す', () => {
        // 2026-04-03 は金曜日
        vi.setSystemTime(new Date('2026-04-03T10:00:00Z'));
        const result = get_next_monday();
        expect(result.getDay()).toBe(1);
        vi.useRealTimers();
    });
});

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

    function make_task(id: string, title: string, percent: number, bucket_id = 'bucket-current'): PlannerTask {
        return {
            id,
            title,
            bucketId: bucket_id,
            percentComplete: percent,
            '@odata.etag': `W/"etag-${id}"`,
        };
    }

    it('投稿タスクが完了 (100%) なら true を返してアーカイブする', async () => {
        const tasks = [
            make_task('t1', '3D制作', 100),
            make_task('t2', '投稿', 100),
        ];
        mock_get.mockResolvedValue({ value: tasks });
        mock_patch.mockResolvedValue({});

        const buckets = new Map([['今週分', 'bucket-current'], ['完了', 'bucket-done']]);
        const result = await archive_current_week('plan-001', buckets);

        expect(result).toBe(true);
        // 2タスク分 PATCH（移動）
        expect(mock_patch).toHaveBeenCalledTimes(2);
        // 全て完了バケットへ移動
        for (const call of mock_patch.mock.calls) {
            expect((call[1] as { bucketId: string }).bucketId).toBe('bucket-done');
        }
    });

    it('投稿タスクが未完了なら false を返して PATCH しない', async () => {
        const tasks = [
            make_task('t1', 'エディット', 100),
            make_task('t2', '投稿', 50),
        ];
        mock_get.mockResolvedValue({ value: tasks });

        const buckets = new Map([['今週分', 'bucket-current'], ['完了', 'bucket-done']]);
        const result = await archive_current_week('plan-001', buckets);

        expect(result).toBe(false);
        expect(mock_patch).not.toHaveBeenCalled();
    });

    it('投稿タスクが見つからない場合は false を返す', async () => {
        mock_get.mockResolvedValue({ value: [make_task('t1', 'エディット', 100)] });

        const buckets = new Map([['今週分', 'bucket-current'], ['完了', 'bucket-done']]);
        const result = await archive_current_week('plan-001', buckets);

        expect(result).toBe(false);
    });

    it('バケットが見つからない場合は false を返す', async () => {
        const buckets = new Map<string, string>(); // 空
        const result = await archive_current_week('plan-001', buckets);
        expect(result).toBe(false);
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

    function make_task(id: string, title: string): PlannerTask {
        return {
            id,
            title,
            bucketId: 'bucket-next',
            percentComplete: 0,
            '@odata.etag': `W/"etag-${id}"`,
        };
    }

    it('来週分のタスクを今週分バケットに移動する', async () => {
        const tasks = [make_task('t1', 'プロット第42話'), make_task('t2', 'ラフネーム')];
        mock_get
            .mockResolvedValueOnce({ value: tasks })  // get_tasks_in_bucket
            .mockResolvedValueOnce({ ...tasks[0], '@odata.etag': 'W/"fresh-1"' }) // fresh t1
            .mockResolvedValueOnce({ ...tasks[1], '@odata.etag': 'W/"fresh-2"' }); // fresh t2
        mock_patch.mockResolvedValue({});

        const buckets = new Map([['来週分', 'bucket-next'], ['今週分', 'bucket-current']]);
        const promoted = await promote_next_week('plan-001', buckets);

        expect(promoted).toHaveLength(2);

        // PATCH で bucketId が今週分に変わっていること
        for (const call of mock_patch.mock.calls) {
            expect((call[1] as { bucketId: string }).bucketId).toBe('bucket-current');
        }
    });

    it('来週分バケットが空なら空配列を返す', async () => {
        mock_get.mockResolvedValueOnce({ value: [] });

        const buckets = new Map([['来週分', 'bucket-next'], ['今週分', 'bucket-current']]);
        const promoted = await promote_next_week('plan-001', buckets);

        expect(promoted).toHaveLength(0);
        expect(mock_patch).not.toHaveBeenCalled();
    });

    it('バケットが見つからない場合は空配列を返す', async () => {
        const buckets = new Map<string, string>();
        const promoted = await promote_next_week('plan-001', buckets);
        expect(promoted).toHaveLength(0);
    });
});

// ─── get_latest_plan テスト ──────────────────────────────────────────────────
describe('get_latest_plan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('複数のプランが存在する場合、createdDateTime が最新のものを返す', async () => {
        const plans = {
            value: [
                { id: 'plan-1', title: 'Old Plan', createdDateTime: '2026-03-01T10:00:00Z' },
                { id: 'plan-2', title: 'New Plan', createdDateTime: '2026-04-01T10:00:00Z' },
                { id: 'plan-3', title: 'Mid Plan', createdDateTime: '2026-03-15T10:00:00Z' },
            ]
        };
        mock_get.mockResolvedValue(plans);

        const result = await get_latest_plan('group-001');

        expect(result).not.toBeNull();
        expect(result?.id).toBe('plan-2');
        expect(result?.title).toBe('New Plan');
        expect(mock_get).toHaveBeenCalledWith('https://graph.microsoft.com/v1.0/groups/group-001/planner/plans');
    });

    it('プランが存在しない場合、null を返す', async () => {
        mock_get.mockResolvedValue({ value: [] });

        const result = await get_latest_plan('group-001');

        expect(result).toBeNull();
    });

    it('API が value を返さない場合、null を返す', async () => {
        mock_get.mockResolvedValue({}); // No 'value' property

        const result = await get_latest_plan('group-001');

        expect(result).toBeNull();
    });
});

// ─── schedule_promoted_tasks テスト ──────────────────────────────────────────
describe('schedule_promoted_tasks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // 2026-03-30 (月) 10:00 JST
        vi.setSystemTime(new Date('2026-03-30T01:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function make_task(id: string, title: string): PlannerTask {
        return {
            id, title,
            bucketId: 'bucket-current',
            percentComplete: 0,
            '@odata.etag': `W/"etag-${id}"`,
        };
    }

    it('マトリクス対象タスク（プロット）を指定日時に配置する', async () => {
        const tasks = [make_task('t1', '第42話のプロット作成')];
        await schedule_promoted_tasks(tasks);

        expect(mock_create_event).toHaveBeenCalledTimes(2); // 水, 木 の2回

        const calls = mock_create_event.mock.calls;

        // 1回目: 水曜 14:00 (JST) = 05:00 (UTC)
        const wed_start = new Date(calls[0][2]);
        expect(wed_start.getUTCDay()).toBe(3); // Wednesday
        expect(wed_start.getUTCHours()).toBe(5);
        const wed_end = new Date(calls[0][3]);
        expect(wed_end.getTime() - wed_start.getTime()).toBe(60 * 60 * 1000); // 2 blocks = 1 hour

        // 2回目: 木曜 14:00 (JST) = 05:00 (UTC)
        const thu_start = new Date(calls[1][2]);
        expect(thu_start.getUTCDay()).toBe(4); // Thursday
        expect(thu_start.getUTCHours()).toBe(5);
    });

    it('マトリクス対象外タスクを月曜9時から順次配置する', async () => {
        const tasks = [
            make_task('t1', '背景資料集め'),
            make_task('t2', 'キャラクターデザイン'),
        ];
        await schedule_promoted_tasks(tasks);

        expect(mock_create_event).toHaveBeenCalledTimes(2);
        const calls = mock_create_event.mock.calls;

        // 1回目: 翌月曜 09:00 (JST) = 00:00 (UTC)
        const mon_start1 = new Date(calls[0][2]);
        expect(mon_start1.getUTCDay()).toBe(1); // Monday
        expect(mon_start1.getUTCHours()).toBe(0);
        const mon_end1 = new Date(calls[0][3]);
        expect(mon_end1.getTime() - mon_start1.getTime()).toBe(30 * 60 * 1000); // 30 min

        // 2回目: 1回目の終了時刻 = 月曜 09:30 (JST)
        const mon_start2 = new Date(calls[1][2]);
        expect(mon_start2.getTime()).toBe(mon_end1.getTime());
    });

    it('タスクが空の場合は何も実行しない', async () => {
        await schedule_promoted_tasks([]);
        expect(mock_create_event).not.toHaveBeenCalled();
    });
});

// ─── generate_next_plot テスト ───────────────────────────────────────────────
describe('generate_next_plot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.M365_USER_ID = 'user-001';
    });

    it('AI が生成したタスクを来週分バケットに投稿する', async () => {
        const ai_tasks = [
            { title: 'プロット案出し', priority: 3, description: '', label: 'Pink' },
            { title: '構成検討', priority: 5, description: '', label: 'Pink' },
        ];
        mock_generate.mockResolvedValue({ output: ai_tasks });
        mock_post.mockResolvedValue({ id: 'new-task' });

        const buckets = new Map([['来週分', 'bucket-next']]);
        await generate_next_plot('plan-001', buckets, '第43話');

        expect(mock_generate).toHaveBeenCalledOnce();
        expect(mock_generate.mock.calls[0][0].prompt).toContain('第43話');

        expect(mock_post).toHaveBeenCalledTimes(2);
        const calls = mock_post.mock.calls;
        expect(calls[0][0]).toBe('https://graph.microsoft.com/v1.0/planner/tasks');
        expect(calls[0][1].planId).toBe('plan-001');
        expect(calls[0][1].bucketId).toBe('bucket-next');
        expect(calls[0][1].title).toBe('プロット案出し');
    });

    it('AI がタスクを生成しない場合は投稿しない', async () => {
        mock_generate.mockResolvedValue({ output: null });
        const buckets = new Map([['来週分', 'bucket-next']]);
        await generate_next_plot('plan-001', buckets, '第43話');

        expect(mock_post).not.toHaveBeenCalled();
    });

    it('来週分バケットがない場合は実行しない', async () => {
        const buckets = new Map();
        await generate_next_plot('plan-001', buckets, '第43話');

        expect(mock_generate).not.toHaveBeenCalled();
        expect(mock_post).not.toHaveBeenCalled();
    });
});
