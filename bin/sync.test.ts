/**
 * @file bin/sync.test.ts
 * @description GoogleSyncService の単体テスト。
 * googleapis と snapshot をモックして、各アクションの動作を検証する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── vi.hoisted でモック関数を宣言 ───────────────────────────────────────────

const { mock_tasks_get, mock_tasks_update, mock_restore, mock_save } = vi.hoisted(() => ({
    mock_tasks_get:    vi.fn(),
    mock_tasks_update: vi.fn(),
    mock_restore:      vi.fn(),
    mock_save:         vi.fn(),
}));

// ─── モック設定 ───────────────────────────────────────────────────────────────

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

vi.mock('googleapis', () => ({
    google: {
        auth:  { OAuth2: class { setCredentials() {} } },
        tasks: vi.fn(() => ({
            tasks: {
                get:    mock_tasks_get,
                update: mock_tasks_update,
            },
        })),
    },
}));

vi.mock('../src/google', () => ({ create_oauth_client: vi.fn(() => ({})) }));
vi.mock('../lib/snapshot', () => ({ snapshot: { restore: mock_restore, save: mock_save } }));

// ─── テスト対象 ───────────────────────────────────────────────────────────────

import { google_sync_service } from './sync';

/** テスト用の有効なメタデータ埋め込み notes を生成する */
const make_meta_notes = (uuid: string) =>
    `[gentask:{"uuid":"${uuid}","event_id":"evt-1","calendar_id":"cal-1","list_id":"list-001","sub_role":"other"}]`;

describe('google_sync_service.apply_actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('no_change はスキップされ update が呼ばれない', async () => {
        const svc = new google_sync_service();
        await svc.apply_actions(
            [{ task_id: 'task-001', action: 'no_change' }],
            new Map([['task-001', 'list-001']])
        );
        expect(mock_tasks_update).not.toHaveBeenCalled();
    });

    it('list_map に存在しない task_id はスキップされ update が呼ばれない', async () => {
        const svc = new google_sync_service();
        await svc.apply_actions(
            [{ task_id: 'unknown-task', action: 'complete' }],
            new Map()
        );
        expect(mock_tasks_update).not.toHaveBeenCalled();
    });

    it('complete は status: completed で update する', async () => {
        mock_tasks_get.mockResolvedValueOnce({ data: {
            notes: make_meta_notes('uuid-001'), title: 'Task', status: 'needsAction',
        } });
        mock_tasks_update.mockResolvedValueOnce({ data: {} });

        const svc = new google_sync_service();
        await svc.apply_actions(
            [{ task_id: 'task-001', action: 'complete' }],
            new Map([['task-001', 'list-001']])
        );

        expect(mock_tasks_update).toHaveBeenCalledWith(expect.objectContaining({
            tasklist:    'list-001',
            task:        'task-001',
            requestBody: expect.objectContaining({ status: 'completed' }),
        }));
    });

    it('reschedule は new_due_date で update する', async () => {
        mock_tasks_get.mockResolvedValueOnce({ data: {
            notes: make_meta_notes('uuid-002'), title: 'Task', status: 'needsAction',
        } });
        mock_tasks_update.mockResolvedValueOnce({ data: {} });

        const svc = new google_sync_service();
        await svc.apply_actions(
            [{ task_id: 'task-002', action: 'reschedule', new_due_date: '2026-04-10T00:00:00Z' }],
            new Map([['task-002', 'list-002']])
        );

        expect(mock_tasks_update).toHaveBeenCalledWith(expect.objectContaining({
            requestBody: expect.objectContaining({ due: '2026-04-10T00:00:00Z' }),
        }));
    });

    it('reschedule で new_due_date がない場合は update しない', async () => {
        const svc = new google_sync_service();
        await svc.apply_actions(
            [{ task_id: 'task-003', action: 'reschedule' }],
            new Map([['task-003', 'list-003']])
        );
        expect(mock_tasks_update).not.toHaveBeenCalled();
    });

    it('add_note は既存 notes に追記して update する', async () => {
        mock_tasks_get.mockResolvedValueOnce({ data: {
            notes: `既存メモ\n${make_meta_notes('uuid-004')}`,
            title: 'Task', status: 'needsAction',
        } });
        mock_tasks_update.mockResolvedValueOnce({ data: {} });

        const svc = new google_sync_service();
        await svc.apply_actions(
            [{ task_id: 'task-004', action: 'add_note', note: '新しいメモ' }],
            new Map([['task-004', 'list-004']])
        );

        const call_arg = mock_tasks_update.mock.calls[0][0] as any;
        expect(call_arg.requestBody.notes).toContain('既存メモ');
        expect(call_arg.requestBody.notes).toContain('新しいメモ');
    });

    it('buffer_consumed も notes に追記して update する', async () => {
        mock_tasks_get.mockResolvedValueOnce({ data: {
            notes: make_meta_notes('uuid-005'),
            title: 'Task', status: 'needsAction',
        } });
        mock_tasks_update.mockResolvedValueOnce({ data: {} });

        const svc = new google_sync_service();
        await svc.apply_actions(
            [{ task_id: 'task-005', action: 'buffer_consumed', note: '神回だった' }],
            new Map([['task-005', 'list-005']])
        );

        const call_arg = mock_tasks_update.mock.calls[0][0] as any;
        expect(call_arg.requestBody.notes).toContain('神回だった');
    });

    it('undo はスナップショットから状態を復元して update する', async () => {
        const uuid = 'uuid-006-undo';
        mock_tasks_get.mockResolvedValueOnce({ data: {
            notes: make_meta_notes(uuid), title: 'Task', status: 'completed',
        } });
        mock_restore.mockReturnValueOnce({
            uuid,
            task_id:   'task-006',
            list_id:   'list-006',
            timestamp: '2026-03-30T10:00:00Z',
            state:     { status: 'needsAction', due: '2026-04-01T00:00:00Z' },
        });
        mock_tasks_update.mockResolvedValueOnce({ data: {} });

        const svc = new google_sync_service();
        await svc.apply_actions(
            [{ task_id: 'task-006', action: 'undo' }],
            new Map([['task-006', 'list-006']])
        );

        expect(mock_restore).toHaveBeenCalledWith(uuid); // UUID で検索（task_id ではない）
        expect(mock_tasks_update).toHaveBeenCalled();
    });
});
