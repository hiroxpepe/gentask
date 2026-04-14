import { describe, it, expect } from 'vitest';
import { task_schema, sync_action_schema } from './types';

describe('task_schema', () => {
    it('valid な入力をパースできる', () => {
        const result = task_schema.parse({
            title: 'テストタスク',
            mode: 'PTASK',
            priority: 3,
            description: '詳細説明',
            label: 'Green',
        });
        expect(result.title).toBe('テストタスク');
        expect(result.mode).toBe('PTASK');
    });

    it('priority のデフォルト値は 5', () => {
        const result = task_schema.parse({
            title: 'タイトル',
            mode: 'TTASK',
            description: '説明',
            label: 'Blue',
        });
        expect(result.priority).toBe(5);
    });

    it('bucket フィールドは省略可能', () => {
        const without_bucket = task_schema.parse({
            title: 'タイトル',
            mode: 'CTASK',
            description: '説明',
            label: 'Red',
        });
        expect(without_bucket.bucket).toBeUndefined();
    });

    it('bucket フィールドに current / next を受け付ける', () => {
        const current_task = task_schema.parse({
            title: 'タイトル',
            mode: 'CTASK',
            description: '説明',
            label: 'Red',
            bucket: 'current',
        });
        expect(current_task.bucket).toBe('current');

        const next_task = task_schema.parse({
            title: 'タイトル',
            mode: 'PTASK',
            description: '説明',
            label: 'Purple',
            bucket: 'next',
        });
        expect(next_task.bucket).toBe('next');
    });

    it('title が空文字だと失敗する', () => {
        expect(() => task_schema.parse({
            title: '',
            mode: 'ATASK',
            description: '説明',
            label: 'Yellow',
        })).toThrow();
    });

    it('mode が不正だと失敗する', () => {
        expect(() => task_schema.parse({
            title: 'タイトル',
            mode: 'XTASK',
            description: '説明',
            label: 'Green',
        })).toThrow();
    });

    it('全 mode を受け付ける', () => {
        for (const mode of ['PTASK', 'TTASK', 'CTASK', 'ATASK'] as const) {
            const result = task_schema.parse({
                title: 'タイトル',
                mode,
                description: '説明',
                label: 'Pink',
            });
            expect(result.mode).toBe(mode);
        }
    });
});

describe('sync_action_schema', () => {
    it('complete アクションをパースできる', () => {
        const result = sync_action_schema.parse({
            task_id: 'task-001',
            action: 'complete',
        });
        expect(result.action).toBe('complete');
    });

    it('undo アクションをパースできる', () => {
        const result = sync_action_schema.parse({
            task_id: 'task-002',
            action: 'undo',
        });
        expect(result.action).toBe('undo');
    });

    it('全 action を受け付ける', () => {
        const actions = ['complete', 'reschedule', 'add_note', 'buffer_consumed', 'no_change', 'undo'] as const;
        for (const action of actions) {
            const result = sync_action_schema.parse({ task_id: 'task-x', action });
            expect(result.action).toBe(action);
        }
    });

    it('reschedule は new_due_date を受け付ける', () => {
        const result = sync_action_schema.parse({
            task_id: 'task-003',
            action: 'reschedule',
            new_due_date: '2026-04-01T00:00:00Z',
        });
        expect(result.new_due_date).toBe('2026-04-01T00:00:00Z');
    });

    it('不正な action は失敗する', () => {
        expect(() => sync_action_schema.parse({
            task_id: 'task-004',
            action: 'fly_to_moon',
        })).toThrow();
    });
});
