import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./graph', () => ({
    graph: {
        post:  vi.fn(),
        get:   vi.fn(),
        patch: vi.fn(),
    },
}));

vi.mock('./outlook', () => {
    return {
        OutlookService: class {
            create_event = vi.fn().mockResolvedValue('outlook-event-id-mock');
        },
    };
});

import { graph } from './graph';
import { PlannerService } from './planner';

const mock_post  = graph.post  as ReturnType<typeof vi.fn>;
const mock_get   = graph.get   as ReturnType<typeof vi.fn>;
const mock_patch = graph.patch as ReturnType<typeof vi.fn>;

describe('PlannerService.ensure_container (3バケット構造)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.M365_USER_ID               = 'user-001';
        process.env.M365_PLANNER_PTASK_GROUP_ID = 'group-ptask';
        process.env.M365_PLANNER_TTASK_GROUP_ID = 'group-ttask';
        process.env.M365_PLANNER_CTASK_GROUP_ID = 'group-ctask';
        process.env.M365_PLANNER_ATASK_GROUP_ID = 'group-atask';
    });

    it('プラン作成後に今週分/来週分/完了 の3バケットを作成する', async () => {
        // プラン作成レスポンス
        mock_post.mockResolvedValueOnce({ id: 'plan-001' });
        // バケット3回作成 (今週分, 来週分, 完了)
        mock_post.mockResolvedValueOnce({ id: 'bucket-current' });
        mock_post.mockResolvedValueOnce({ id: 'bucket-next' });
        mock_post.mockResolvedValueOnce({ id: 'bucket-done' });

        const service = new PlannerService();
        // プライベートメソッドを呼ぶためキャスト
        const result = await (service as unknown as { ensure_container: (mode: string) => Promise<unknown> }).ensure_container('PTASK');

        // バケット作成呼び出しを確認
        const bucket_calls = mock_post.mock.calls.filter(
            (c: unknown[][]) => (c[0] as unknown as string).includes('/planner/buckets')
        );
        expect(bucket_calls).toHaveLength(3);

        const bucket_names = bucket_calls.map((c: unknown[][]) => (c[1] as unknown as { name: string }).name);
        expect(bucket_names).toContain('今週分');
        expect(bucket_names).toContain('来週分');
        expect(bucket_names).toContain('完了');
    });

    it('同じモードを2回呼ぶとキャッシュが効いて API は1回しか呼ばれない', async () => {
        mock_post
            .mockResolvedValueOnce({ id: 'plan-001' })
            .mockResolvedValueOnce({ id: 'bucket-current' })
            .mockResolvedValueOnce({ id: 'bucket-next' })
            .mockResolvedValueOnce({ id: 'bucket-done' });

        const service = new PlannerService();
        const ensure = (mode: string) =>
            (service as unknown as { ensure_container: (mode: string) => Promise<unknown> }).ensure_container(mode);

        await ensure('CTASK');
        await ensure('CTASK'); // 2回目はキャッシュから

        // post はプラン1回 + バケット3回 = 4回のみ
        expect(mock_post).toHaveBeenCalledTimes(4);
    });
});

describe('PlannerService.execute_deployment', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.M365_USER_ID               = 'user-001';
        process.env.M365_PLANNER_PTASK_GROUP_ID = 'group-ptask';
        process.env.M365_PLANNER_CTASK_GROUP_ID = 'group-ctask';
    });

    function setup_mocks() {
        // PTASK のプラン+バケット作成
        mock_post
            .mockResolvedValueOnce({ id: 'plan-ptask' })
            .mockResolvedValueOnce({ id: 'bucket-ptask-current' })
            .mockResolvedValueOnce({ id: 'bucket-ptask-next' })
            .mockResolvedValueOnce({ id: 'bucket-ptask-done' })
            // PTASK タスク作成 + Open Extension POST
            .mockResolvedValueOnce({ id: 'task-p-001' })
            .mockResolvedValueOnce({ id: 'ext-p-001' })
            // CTASK のプラン+バケット作成
            .mockResolvedValueOnce({ id: 'plan-ctask' })
            .mockResolvedValueOnce({ id: 'bucket-ctask-current' })
            .mockResolvedValueOnce({ id: 'bucket-ctask-next' })
            .mockResolvedValueOnce({ id: 'bucket-ctask-done' })
            // CTASK タスク作成 + Open Extension POST
            .mockResolvedValueOnce({ id: 'task-c-001' })
            .mockResolvedValue({ id: 'ext-c-001' });
        mock_get.mockResolvedValue({ '@odata.etag': 'W/"etag"' });
        mock_patch.mockResolvedValue({});
    }

    it('PTASK は来週分バケットに、CTASK は今週分バケットに配置される', async () => {
        setup_mocks();

        const service = new PlannerService();
        await service.execute_deployment([
            { title: 'プロット作業', mode: 'PTASK', priority: 3, description: '説明', label: 'Green' },
            { title: 'レイアウト作業', mode: 'CTASK', priority: 5, description: '説明', label: 'Blue' },
        ]);

        // タスク作成呼び出しの bucketId を確認
        const task_creates = mock_post.mock.calls.filter(
            (c: unknown[][]) => (c[0] as unknown as string).includes('/planner/tasks') && !(c[0] as unknown as string).includes('/extensions')
        );
        expect(task_creates).toHaveLength(2);

        // PTASK → bucket-ptask-next (来週分)
        expect((task_creates[0][1] as { bucketId: string }).bucketId).toBe('bucket-ptask-next');
        // CTASK → bucket-ctask-current (今週分)
        expect((task_creates[1][1] as { bucketId: string }).bucketId).toBe('bucket-ctask-current');
    });

    it('task.bucket で明示的に current を指定した PTASK は今週分に入る', async () => {
        // PTASK のプラン+バケット
        mock_post
            .mockResolvedValueOnce({ id: 'plan-ptask' })
            .mockResolvedValueOnce({ id: 'bucket-current' })
            .mockResolvedValueOnce({ id: 'bucket-next' })
            .mockResolvedValueOnce({ id: 'bucket-done' })
            .mockResolvedValueOnce({ id: 'task-p-001' })
            .mockResolvedValue({ id: 'ext-x' });

        mock_get.mockResolvedValue({ '@odata.etag': 'W/"etag"' });
        mock_patch.mockResolvedValue({});

        const service = new PlannerService();
        await service.execute_deployment([
            { title: '今週プロット', mode: 'PTASK', priority: 3, description: '説明', label: 'Green', bucket: 'current' },
        ]);

        const task_create = mock_post.mock.calls.find(
            (c: unknown[][]) => (c[0] as unknown as string).endsWith('/planner/tasks')
        );
        expect((task_create![1] as { bucketId: string }).bucketId).toBe('bucket-current');
    });
});
