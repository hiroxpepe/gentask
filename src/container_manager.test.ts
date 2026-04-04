import { describe, it, expect, vi, beforeEach } from 'vitest';
import { graph } from '../lib/graph';
import { PlannerContainerManager } from './container_manager';

vi.mock('../lib/graph');

const mock_post = vi.mocked(graph.post);

describe('PlannerContainerManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.M365_PLANNER_PTASK_GROUP_ID = 'group-ptask';
        process.env.M365_PLANNER_CTASK_GROUP_ID = 'group-ctask';
    });

    describe('get_container', () => {
        it('プラン作成後に今週分/来週分/完了 の3バケットを作成する', async () => {
            // プラン作成レスポンス
            mock_post.mockResolvedValueOnce({ id: 'plan-001' });
            // バケット3回作成 (今週分, 来週分, 完了)
            mock_post.mockResolvedValueOnce({ id: 'bucket-current' });
            mock_post.mockResolvedValueOnce({ id: 'bucket-next' });
            mock_post.mockResolvedValueOnce({ id: 'bucket-done' });

            const manager = new PlannerContainerManager();
            const result = await manager.get_container('PTASK');

            expect(result.plan_id).toBe('plan-001');
            expect(result.buckets.current).toBe('bucket-current');
            expect(result.buckets.next).toBe('bucket-next');
            expect(result.buckets.done).toBe('bucket-done');

            // バケット作成呼び出しを確認
            const bucket_calls = mock_post.mock.calls.filter(
                (c) => (c[0] as string).includes('/planner/buckets')
            );
            expect(bucket_calls).toHaveLength(3);

            const bucket_names = bucket_calls.map((c) => (c[1] as { name: string }).name);
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

            const manager = new PlannerContainerManager();

            await manager.get_container('CTASK');
            await manager.get_container('CTASK'); // 2回目はキャッシュから

            // post はプラン1回 + バケット3回 = 4回のみ
            expect(mock_post).toHaveBeenCalledTimes(4);
        });
    });
});
