import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('validate_env', () => {
    const REQUIRED = [
        'GCP_VERTEX_AI_API_KEY',
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_CALENDAR_ID',
    ];

    let original_env: NodeJS.ProcessEnv;
    let exit_spy: ReturnType<typeof vi.spyOn>;
    let error_spy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        original_env = { ...process.env };
        exit_spy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('process.exit called'); }) as (code?: number | undefined) => never);
        error_spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        process.env = original_env;
        exit_spy.mockRestore();
        error_spy.mockRestore();
    });

    it('全必須変数が揃っている場合は正常終了し、何も出力しない', async () => {
        for (const key of REQUIRED) {
            process.env[key] = 'dummy-value';
        }

        const { validate_env } = await import('./env');
        expect(() => validate_env()).not.toThrow();
        expect(exit_spy).not.toHaveBeenCalled();
        expect(error_spy).not.toHaveBeenCalled();
    });

    it('1つ欠損がある場合に、欠損リストとエラーを出力して終了する', async () => {
        for (const key of REQUIRED) {
            process.env[key] = 'dummy-value';
        }
        delete process.env['GOOGLE_CLIENT_ID'];

        const { validate_env } = await import('./env');
        expect(() => validate_env()).toThrow('process.exit called');
        expect(exit_spy).toHaveBeenCalledWith(1);

        // エラー出力の検証
        expect(error_spy).toHaveBeenCalledWith('❌ Missing required environment variables:');
        expect(error_spy).toHaveBeenCalledWith(expect.stringContaining('GOOGLE_CLIENT_ID'));
    });

    it('複数欠損がある場合に、全ての欠損リストを出力して終了する', async () => {
        // GOOGLE_CLIENT_ID と GCP_VERTEX_AI_API_KEY を欠損させる
        for (const key of REQUIRED) {
            process.env[key] = 'dummy-value';
        }
        delete process.env['GOOGLE_CLIENT_ID'];
        delete process.env['GCP_VERTEX_AI_API_KEY'];

        const { validate_env } = await import('./env');
        expect(() => validate_env()).toThrow('process.exit called');
        expect(exit_spy).toHaveBeenCalledWith(1);

        // エラー出力の検証
        expect(error_spy).toHaveBeenCalledWith('❌ Missing required environment variables:');
        expect(error_spy).toHaveBeenCalledWith(expect.stringContaining('GOOGLE_CLIENT_ID'));
        expect(error_spy).toHaveBeenCalledWith(expect.stringContaining('GCP_VERTEX_AI_API_KEY'));
        // 最後のメッセージも確認
        expect(error_spy).toHaveBeenCalledWith(expect.stringContaining('Check your .env file'));
    });
});
