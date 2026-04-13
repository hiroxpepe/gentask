import { zodToJsonSchema } from 'zod-to-json-schema';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { task_schema } from './index';

// Hoist the mock
const { mock_generate } = vi.hoisted(() => ({
    mock_generate: vi.fn(),
}));

// Mock genkit and googleAI
vi.mock('genkit', () => ({
    genkit: vi.fn(() => ({
        defineFlow: vi.fn((_def, fn) => fn),
        generate: mock_generate,
    })),
    z: z, // Use the real z object
}));

vi.mock('@genkit-ai/googleai', () => ({
    googleAI: vi.fn(() => ({})),
    gemini20Flash: 'gemini-2.0-flash',
}));

import { task_flow } from './index';

// Type assertion for the flow function
const typed_task_flow = task_flow as (input: string) => Promise<unknown>;

describe('task_flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('AI Interaction', () => {
        it('should call the AI generation engine and return its output', async () => {
            const expected_tasks = [
                { title: 'タスクA', mode: 'PTASK', priority: 3, description: '説明', label: 'Green' },
            ];
            mock_generate.mockResolvedValueOnce({ output: expected_tasks });

            const result = await typed_task_flow('マンガ連載');

            expect(mock_generate).toHaveBeenCalledOnce();
            expect(result).toEqual(expected_tasks);
        });

        it('should throw an error if the AI fails to generate output', async () => {
            mock_generate.mockResolvedValueOnce({ output: null });

            await expect(typed_task_flow('マンガ連載')).rejects.toThrow('AI failed to generate valid task sequence.');
        });
    });

    describe('Prompt Engineering', () => {
        it('should construct a comprehensive prompt based on the input subject', async () => {
            mock_generate.mockResolvedValueOnce({ output: [] }); // We don't care about the output here
            const input_subject = '新しいゲーム開発';
            await typed_task_flow(input_subject);

            expect(mock_generate).toHaveBeenCalledOnce();
            const generate_call_args = mock_generate.mock.calls[0][0];

            // 1. Check if the prompt contains the core instructions
            expect(generate_call_args.prompt).toContain('あなたは週刊漫画連載の超一流マネージャーです。');
            expect(generate_call_args.prompt).toContain(`「${input_subject}」を達成するために必要な具体的タスクを`);
            expect(generate_call_args.prompt).toContain('P(戦略)・T(技術)・C(制作)・A(事務) の全方位から網羅的に分解');

            // 2. Check if the output schema is correctly passed
            expect(generate_call_args.output).toBeDefined();
            expect(zodToJsonSchema(generate_call_args.output.schema)).toEqual(zodToJsonSchema(z.array(task_schema)));
        });
    });
});
