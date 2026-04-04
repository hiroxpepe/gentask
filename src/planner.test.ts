import { describe, it, expect, vi, beforeEach } from 'vitest';
import { graph } from '../lib/graph';
import { PlannerService } from './planner';
import { PlannerContainerManager } from './container_manager';

// Mock external dependencies
vi.mock('../lib/graph');
vi.mock('../lib/outlook', () => ({
    OutlookService: class {
        create_event = vi.fn().mockResolvedValue('outlook-event-id-mock');
    },
}));

const mock_get_container = vi.fn();
vi.mock('./container_manager', () => ({
    PlannerContainerManager: class {
        get_container = mock_get_container;
    },
}));

const mock_post = vi.mocked(graph.post);
const mock_get = vi.mocked(graph.get);
const mock_patch = vi.mocked(graph.patch);

describe('PlannerService.execute_deployment', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mock_get_container.mockClear();
        process.env.M365_USER_ID = 'user-001';
    });

    // Sets up the mock get_container to return specific bucket IDs for different task modes.
    function setup_container_mocks() {
        mock_get_container.mockImplementation(async (mode: string) => {
            if (mode === 'PTASK') {
                return {
                    plan_id: 'plan-ptask',
                    buckets: {
                        current: 'bucket-ptask-current',
                        next: 'bucket-ptask-next',
                        done: 'bucket-ptask-done',
                    },
                };
            }
            if (mode === 'CTASK') {
                return {
                    plan_id: 'plan-ctask',
                    buckets: {
                        current: 'bucket-ctask-current',
                        next: 'bucket-ctask-next',
                        done: 'bucket-ctask-done',
                    },
                };
            }
            return null;
        });
    }

    // Generic mock setup for graph API calls to reduce repetition.
    function setup_graph_mocks() {
        mock_post.mockResolvedValue({ id: 'new-post-id' });
        mock_get.mockResolvedValue({ '@odata.etag': 'W/"etag"' });
        mock_patch.mockResolvedValue({});
    }

    it('PTASK は来週分バケットに、CTASK は今週分バケットに配置される', async () => {
        setup_container_mocks();
        setup_graph_mocks();

        const service = new PlannerService();
        await service.execute_deployment([
            { title: 'プロット作業', mode: 'PTASK', priority: 3, description: '説明', label: 'Green' },
            { title: 'レイアウト作業', mode: 'CTASK', priority: 5, description: '説明', label: 'Blue' },
        ]);

        // Verify that get_container was called for each mode
        expect(mock_get_container).toHaveBeenCalledWith('PTASK');
        expect(mock_get_container).toHaveBeenCalledWith('CTASK');

        // Verify the bucketId and label used in the task creation call
        const task_creates = mock_post.mock.calls.filter((c) => (c[0] as string).includes('/planner/tasks'));
        expect(task_creates).toHaveLength(4); // 2 for tasks, 2 for extensions

        const task_create_bodies = task_creates
            .filter(c => !(c[0] as string).includes('/extensions'))
            .map(c => c[1] as { bucketId: string, appliedCategories: Record<string, boolean> });

        // 1. PTASK should be in the 'next' bucket and have the correct category
        expect(task_create_bodies[0].bucketId).toBe('bucket-ptask-next');
        expect(task_create_bodies[0].appliedCategories.category4).toBe(true); // Green

        // 2. CTASK should be in the 'current' bucket and have the correct category
        expect(task_create_bodies[1].bucketId).toBe('bucket-ctask-current');
        expect(task_create_bodies[1].appliedCategories.category5).toBe(true); // Blue
    });

    it('task.bucket で明示的に current を指定した PTASK は今週分に入る', async () => {
        setup_container_mocks();
        setup_graph_mocks();

        const service = new PlannerService();
        await service.execute_deployment([
            { title: '今週プロット', mode: 'PTASK', priority: 3, description: '説明', label: 'Green', bucket: 'current' },
        ]);

        const task_create = mock_post.mock.calls.find((c) => (c[0] as string).endsWith('/planner/tasks'));
        expect((task_create![1] as { bucketId: string }).bucketId).toBe('bucket-ptask-current');
    });

    it('task.bucket で明示的に next を指定した CTASK は来週分に入る', async () => {
        setup_container_mocks();
        setup_graph_mocks();

        const service = new PlannerService();
        await service.execute_deployment([
            { title: '来週に回す作業', mode: 'CTASK', priority: 5, description: '説明', label: 'Purple', bucket: 'next' },
        ]);

        const task_create = mock_post.mock.calls.find((c) => (c[0] as string).endsWith('/planner/tasks'));
        expect((task_create![1] as { bucketId: string }).bucketId).toBe('bucket-ctask-next');
    });
});