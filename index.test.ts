import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted で mock 変数を imports より前に宣言
const { mock_generate } = vi.hoisted(() => ({
    mock_generate: vi.fn(),
}));

// genkit と googleAI のモック（task_flow の定義時に実行されるため必要）
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

import { task_flow } from './index';

describe('task_flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('generate を呼び出してタスク配列を返す', async () => {
        const expected_tasks = [
            { title: 'タスクA', mode: 'PTASK', priority: 3, description: '説明', label: 'Green' },
        ];
        mock_generate.mockResolvedValueOnce({ output: expected_tasks });

        const result = await (task_flow as (s: string) => Promise<unknown>)('マンガ連載');

        expect(mock_generate).toHaveBeenCalledOnce();
        expect(mock_generate).toHaveBeenCalledWith(
            expect.objectContaining({ prompt: expect.stringContaining('マンガ連載') })
        );
        expect(result).toEqual(expected_tasks);
    });

    it('generate が output: null を返した場合は Error を throw する', async () => {
        mock_generate.mockResolvedValueOnce({ output: null });

        await expect(
            (task_flow as (s: string) => Promise<unknown>)('マンガ連載')
        ).rejects.toThrow('AI failed to generate valid task sequence.');
    });
});
