import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./graph', () => ({
    graph: {
        post:  vi.fn(),
        get:   vi.fn(),
        patch: vi.fn(),
    },
}));

vi.mock('./outlook', () => ({
    OutlookService: vi.fn().mockImplementation(() => ({
        create_event: vi.fn().mockResolvedValue('outlook-event-mock'),
    })),
}));

// genkit モック
vi.mock('genkit', async () => {
    const zod = await import('zod');
    return {
        genkit: vi.fn(() => ({
            defineFlow: vi.fn((_def: unknown, fn: unknown) => fn),
            generate:   vi.fn(),
        })),
        z: zod.z,
    };
});
vi.mock('@genkit-ai/googleai', () => ({
    googleAI:      vi.fn(() => ({})),
    gemini20Flash: 'gemini-2.0-flash',
}));

import { graph } from './graph';
import {
    get_next_monday,
    get_weekday_date,
    archive_current_week,
    promote_next_week,
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
