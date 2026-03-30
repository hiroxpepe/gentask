import { describe, it, expect, vi, beforeEach } from 'vitest';

// child_process.spawn をモックして az rest コマンドを差し替える
vi.mock('child_process', () => {
    return {
        spawn: vi.fn(),
    };
});

// snapshot をモック（graph.patch 内の snapshot.save が実行されないよう）
vi.mock('./snapshot', () => ({
    snapshot: {
        save: vi.fn(),
        restore: vi.fn(),
        list_snapshots: vi.fn(),
    },
}));

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { graph } from './graph';

/**
 * spawn の戻り値として使う偽プロセスを生成する。
 * stdin.end() が呼ばれたタイミングで stdout データを emit し、その後 close を発火させる。
 * これにより proc.stdout.on('data', ...) が確実に登録済みの状態でデータが流れる。
 */
function make_fake_proc(stdout_data: string, exit_code = 0) {
    let close_cb: ((code: number) => void) | null = null;

    const proc = {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        stdin: {
            write: vi.fn(),
            end: vi.fn().mockImplementation(() => {
                setImmediate(() => {
                    proc.stdout.emit('data', Buffer.from(stdout_data));
                    setImmediate(() => {
                        if (close_cb) close_cb(exit_code);
                    });
                });
            }),
        },
        on: vi.fn((event: string, cb: (code: number) => void) => {
            if (event === 'close') close_cb = cb;
        }),
    };
    return proc;
}

describe('graph.post', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('POST リクエストを az rest に正しい引数で渡す', async () => {
        const fake_response = JSON.stringify({ id: 'new-id-123' });
        (spawn as ReturnType<typeof vi.fn>).mockReturnValue(make_fake_proc(fake_response));

        const result = await graph.post('https://graph.microsoft.com/v1.0/test', { key: 'value' });

        expect(spawn).toHaveBeenCalledWith(
            'az',
            ['rest', '--method', 'post', '--url', 'https://graph.microsoft.com/v1.0/test', '--body', '@-'],
            expect.any(Object)
        );
        expect(result.id).toBe('new-id-123');
    });

    it('リクエストボディを stdin 経由で渡す', async () => {
        const fake_proc = make_fake_proc(JSON.stringify({ id: 'x' }));
        (spawn as ReturnType<typeof vi.fn>).mockReturnValue(fake_proc);

        await graph.post('https://graph.microsoft.com/v1.0/test', { hello: 'world' });

        expect(fake_proc.stdin.write).toHaveBeenCalledWith('{"hello":"world"}');
        expect(fake_proc.stdin.end).toHaveBeenCalled();
    });
});

describe('graph.get', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('GET リクエストを az rest に正しい引数で渡す', async () => {
        const fake_response = JSON.stringify({ value: [{ id: 'item-1' }] });
        (spawn as ReturnType<typeof vi.fn>).mockReturnValue(make_fake_proc(fake_response));

        const result = await graph.get('https://graph.microsoft.com/v1.0/me/events');

        expect(spawn).toHaveBeenCalledWith(
            'az',
            ['rest', '--method', 'get', '--url', 'https://graph.microsoft.com/v1.0/me/events'],
            expect.any(Object)
        );
        expect(result.value[0].id).toBe('item-1');
    });
});

describe('graph.patch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('PATCH リクエストに If-Match ヘッダーを付加する', async () => {
        // 最初の呼び出し（snapshot のための GET）と PATCH の 2 回 spawn される
        (spawn as ReturnType<typeof vi.fn>)
            .mockReturnValueOnce(make_fake_proc(JSON.stringify({ '@odata.etag': 'W/"etag123"' })))
            .mockReturnValueOnce(make_fake_proc(''));

        await graph.patch(
            'https://graph.microsoft.com/v1.0/planner/tasks/abc',
            { percentComplete: 100 },
            { 'If-Match': 'W/"etag123"' }
        );

        // PATCH 呼び出しに --header If-Match=... が含まれているか確認
        const calls = (spawn as ReturnType<typeof vi.fn>).mock.calls;
        const patch_call = calls.find((c: string[][]) => c[1].includes('patch'));
        expect(patch_call).toBeDefined();
        expect(patch_call![1]).toContain('--header');
        expect(patch_call![1]).toContain('If-Match=W/"etag123"');
    });

    it('空レスポンスの PATCH は空オブジェクトを返す', async () => {
        (spawn as ReturnType<typeof vi.fn>)
            .mockReturnValueOnce(make_fake_proc(JSON.stringify({}))) // snapshot GET
            .mockReturnValueOnce(make_fake_proc(''));                 // actual PATCH → 空

        const result = await graph.patch(
            'https://graph.microsoft.com/v1.0/planner/tasks/abc',
            { percentComplete: 100 }
        );

        expect(result).toEqual({});
    });
});

describe('graph error handling', () => {
    it('az rest が非ゼロ終了コードで reject される', async () => {
        (spawn as ReturnType<typeof vi.fn>).mockReturnValue(make_fake_proc('', 1));

        await expect(graph.get('https://graph.microsoft.com/v1.0/fail')).rejects.toThrow('az rest failed');
    });
});

