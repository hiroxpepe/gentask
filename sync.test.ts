import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./graph', () => ({
    graph: {
        post:  vi.fn(),
        get:   vi.fn(),
        patch: vi.fn(),
    },
}));

vi.mock('./snapshot', () => ({
    snapshot: {
        save:            vi.fn(),
        restore:         vi.fn(),
        list_snapshots:  vi.fn(),
    },
}));

// genkit と googleAI のモック（sync_flow の定義時に実行されるため必要）
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
import { snapshot } from './snapshot';
import { PlannerSyncService } from './sync';

const mock_get   = graph.get   as ReturnType<typeof vi.fn>;
const mock_patch = graph.patch as ReturnType<typeof vi.fn>;
const mock_restore = snapshot.restore as ReturnType<typeof vi.fn>;

describe('PlannerSyncService.apply_actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('no_change はスキップされ API が呼ばれない', async () => {
        const svc = new PlannerSyncService();
        await svc.apply_actions([{ plannerTaskId: 'task-001', action: 'no_change' }]);
        expect(mock_get).not.toHaveBeenCalled();
        expect(mock_patch).not.toHaveBeenCalled();
    });

    it('complete は percentComplete: 100 で PATCH する', async () => {
        mock_get.mockResolvedValueOnce({ '@odata.etag': 'W/"etag-1"' });
        mock_patch.mockResolvedValueOnce({});

        const svc = new PlannerSyncService();
        await svc.apply_actions([{ plannerTaskId: 'task-001', action: 'complete' }]);

        expect(mock_get).toHaveBeenCalledWith(expect.stringContaining('task-001'));
        expect(mock_patch).toHaveBeenCalledWith(
            expect.stringContaining('task-001'),
            { percentComplete: 100 },
            { 'If-Match': 'W/"etag-1"' }
        );
    });

    it('reschedule は dueDateTime を PATCH する', async () => {
        mock_get.mockResolvedValueOnce({ '@odata.etag': 'W/"etag-2"' });
        mock_patch.mockResolvedValueOnce({});

        const svc = new PlannerSyncService();
        await svc.apply_actions([{
            plannerTaskId: 'task-002',
            action: 'reschedule',
            newDueDate: '2026-04-10T00:00:00Z',
        }]);

        expect(mock_patch).toHaveBeenCalledWith(
            expect.stringContaining('task-002'),
            { dueDateTime: '2026-04-10T00:00:00Z' },
            { 'If-Match': 'W/"etag-2"' }
        );
    });

    it('reschedule で newDueDate がない場合は PATCH しない', async () => {
        const svc = new PlannerSyncService();
        await svc.apply_actions([{ plannerTaskId: 'task-003', action: 'reschedule' }]);
        expect(mock_patch).not.toHaveBeenCalled();
    });

    it('add_note は description に追記する', async () => {
        mock_get.mockResolvedValueOnce({
            '@odata.etag': 'W/"etag-3"',
            description: '既存メモ',
        });
        mock_patch.mockResolvedValueOnce({});

        const svc = new PlannerSyncService();
        await svc.apply_actions([{ plannerTaskId: 'task-004', action: 'add_note', note: '新しいメモ' }]);

        const patch_body = mock_patch.mock.calls[0][1] as { description: string };
        expect(patch_body.description).toContain('既存メモ');
        expect(patch_body.description).toContain('新しいメモ');
    });

    it('buffer_consumed も description に追記する', async () => {
        mock_get.mockResolvedValueOnce({
            '@odata.etag': 'W/"etag-4"',
            description: '',
        });
        mock_patch.mockResolvedValueOnce({});

        const svc = new PlannerSyncService();
        await svc.apply_actions([{ plannerTaskId: 'task-005', action: 'buffer_consumed', note: '神回だった' }]);

        const patch_body = mock_patch.mock.calls[0][1] as { description: string };
        expect(patch_body.description).toContain('神回だった');
    });

    it('undo はスナップショットから状態を復元して PATCH する', async () => {
        const task_url = 'https://graph.microsoft.com/v1.0/planner/tasks/task-006';
        mock_restore.mockReturnValueOnce(new Map([
            [task_url, {
                taskId: 'task-006',
                url: task_url,
                timestamp: '2026-03-30T10:00:00Z',
                state: { percentComplete: 0, dueDateTime: '2026-04-01T00:00:00Z' },
            }],
        ]));
        mock_get.mockResolvedValueOnce({ '@odata.etag': 'W/"etag-6"' });
        mock_patch.mockResolvedValueOnce({});

        const svc = new PlannerSyncService();
        await svc.apply_actions([{ plannerTaskId: 'task-006', action: 'undo' }]);

        expect(mock_restore).toHaveBeenCalledWith('task-006');
        expect(mock_patch).toHaveBeenCalledWith(
            task_url,
            { percentComplete: 0, dueDateTime: '2026-04-01T00:00:00Z' },
            { 'If-Match': 'W/"etag-6"' }
        );
    });

    it('undo でスナップショットが存在しない場合は PATCH しない', async () => {
        mock_restore.mockReturnValueOnce(new Map());

        const svc = new PlannerSyncService();
        await svc.apply_actions([{ plannerTaskId: 'task-007', action: 'undo' }]);
        expect(mock_patch).not.toHaveBeenCalled();
    });
});
