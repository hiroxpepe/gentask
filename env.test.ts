import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('validate_env', () => {
    const REQUIRED = [
        'M365_USER_ID',
        'M365_PLANNER_PTASK_GROUP_ID',
        'M365_PLANNER_TTASK_GROUP_ID',
        'M365_PLANNER_CTASK_GROUP_ID',
        'M365_PLANNER_ATASK_GROUP_ID',
        'GCP_VERTEX_AI_API_KEY',
    ];

    let original_env: NodeJS.ProcessEnv;
    let exit_spy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        original_env = { ...process.env };
        exit_spy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
            throw new Error('process.exit called');
        });
    });

    afterEach(() => {
        process.env = original_env;
        exit_spy.mockRestore();
    });

    it('全必須変数が揃っている場合は正常終了（exit が呼ばれない）', async () => {
        for (const key of REQUIRED) {
            process.env[key] = 'dummy-value';
        }

        const { validate_env } = await import('./env');
        expect(() => validate_env()).not.toThrow();
        expect(exit_spy).not.toHaveBeenCalled();
    });

    it('1つでも欠損があると process.exit(1) が呼ばれる', async () => {
        for (const key of REQUIRED) {
            process.env[key] = 'dummy-value';
        }
        delete process.env['M365_USER_ID'];

        const { validate_env } = await import('./env');
        expect(() => validate_env()).toThrow('process.exit called');
        expect(exit_spy).toHaveBeenCalledWith(1);
    });

    it('複数欠損の場合も process.exit(1) が呼ばれる', async () => {
        for (const key of REQUIRED) {
            delete process.env[key];
        }

        const { validate_env } = await import('./env');
        expect(() => validate_env()).toThrow('process.exit called');
        expect(exit_spy).toHaveBeenCalledWith(1);
    });
});
