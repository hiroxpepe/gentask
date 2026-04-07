/**
 * @file src/google-container-manager.test.ts
 * @description GoogleContainerManager の単体テスト。
 * fs と googleapis をモックして、リストの取得・作成・キャッシュ動作を検証する。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── vi.hoisted でモック関数を宣言 ───────────────────────────────────────────

const {
    mock_exists_sync,
    mock_read_file_sync,
    mock_write_file_sync,
    mock_mkdir_sync,
    mock_tasklists_list,
    mock_tasklists_insert,
} = vi.hoisted(() => ({
    mock_exists_sync:     vi.fn(),
    mock_read_file_sync:  vi.fn(),
    mock_write_file_sync: vi.fn(),
    mock_mkdir_sync:      vi.fn(),
    mock_tasklists_list:  vi.fn(),
    mock_tasklists_insert: vi.fn(),
}));

// ─── モック設定 ───────────────────────────────────────────────────────────────

vi.mock('fs', () => ({
    default: {
        existsSync:    mock_exists_sync,
        readFileSync:  mock_read_file_sync,
        writeFileSync: mock_write_file_sync,
        mkdirSync:     mock_mkdir_sync,
    },
    existsSync:    mock_exists_sync,
    readFileSync:  mock_read_file_sync,
    writeFileSync: mock_write_file_sync,
    mkdirSync:     mock_mkdir_sync,
}));

vi.mock('googleapis', () => ({
    google: {
        auth:  { OAuth2: class { setCredentials() {} } },
        tasks: vi.fn(() => ({
            tasklists: {
                list:   mock_tasklists_list,
                insert: mock_tasklists_insert,
            },
        })),
    },
}));

vi.mock('./google', () => ({ createOAuthClient: vi.fn(() => ({})) }));

// ─── テスト ───────────────────────────────────────────────────────────────────

import { GoogleContainerManager } from './google-container-manager';

describe('GoogleContainerManager', () => {

    beforeEach(() => {
        vi.resetAllMocks();
        // デフォルト: キャッシュファイルなし
        mock_exists_sync.mockReturnValue(false);
    });

    it('キャッシュが存在する場合は API を呼ばずにキャッシュを返す', async () => {
        const cached = {
            PTASK: { current: 'list-c', next: 'list-n', done: 'list-d' },
        };
        mock_exists_sync.mockReturnValue(true);
        mock_read_file_sync.mockReturnValue(JSON.stringify(cached));

        const manager = new GoogleContainerManager();
        const result = await manager.get_container('PTASK', {});

        expect(result).toEqual(cached.PTASK);
        expect(mock_tasklists_list).not.toHaveBeenCalled();
    });

    it('既存リストがある場合はそのIDを使い新規作成しない', async () => {
        mock_exists_sync.mockReturnValue(false);
        mock_tasklists_list.mockResolvedValue({
            data: {
                items: [
                    { id: 'existing-c', title: 'gentask_PTASK_今週分' },
                    { id: 'existing-n', title: 'gentask_PTASK_来週分' },
                    { id: 'existing-d', title: 'gentask_PTASK_完了' },
                ],
            },
        });

        const manager = new GoogleContainerManager();
        const result = await manager.get_container('PTASK', {});

        expect(mock_tasklists_insert).not.toHaveBeenCalled();
        expect(result.current).toBe('existing-c');
        expect(result.next).toBe('existing-n');
        expect(result.done).toBe('existing-d');
    });

    it('リストが存在しない場合は新規作成する', async () => {
        mock_exists_sync.mockReturnValue(false);
        mock_tasklists_list.mockResolvedValue({ data: { items: [] } });
        mock_tasklists_insert
            .mockResolvedValueOnce({ data: { id: 'new-c' } })
            .mockResolvedValueOnce({ data: { id: 'new-n' } })
            .mockResolvedValueOnce({ data: { id: 'new-d' } });

        const manager = new GoogleContainerManager();
        const result = await manager.get_container('CTASK', {});

        expect(mock_tasklists_insert).toHaveBeenCalledTimes(3);
        expect(mock_tasklists_insert).toHaveBeenCalledWith({
            requestBody: { title: 'gentask_CTASK_今週分' },
        });
        expect(result.current).toBe('new-c');
        expect(result.next).toBe('new-n');
        expect(result.done).toBe('new-d');
    });

    it('取得後にキャッシュをファイルに保存する', async () => {
        mock_exists_sync.mockReturnValue(false);
        mock_tasklists_list.mockResolvedValue({ data: { items: [] } });
        mock_tasklists_insert
            .mockResolvedValueOnce({ data: { id: 'id-c' } })
            .mockResolvedValueOnce({ data: { id: 'id-n' } })
            .mockResolvedValueOnce({ data: { id: 'id-d' } });

        const manager = new GoogleContainerManager();
        await manager.get_container('TTASK', {});

        expect(mock_write_file_sync).toHaveBeenCalledOnce();
        const written = mock_write_file_sync.mock.calls[0][1] as string;
        const parsed = JSON.parse(written);
        expect(parsed.TTASK.current).toBe('id-c');
    });

    it('一部のリストが存在し一部が存在しない場合、存在しないもののみ作成する', async () => {
        mock_exists_sync.mockReturnValue(false);
        mock_tasklists_list.mockResolvedValue({
            data: {
                items: [
                    { id: 'existing-c', title: 'gentask_ATASK_今週分' },
                    // 来週分と完了は存在しない
                ],
            },
        });
        mock_tasklists_insert
            .mockResolvedValueOnce({ data: { id: 'new-n' } })
            .mockResolvedValueOnce({ data: { id: 'new-d' } });

        const manager = new GoogleContainerManager();
        const result = await manager.get_container('ATASK', {});

        expect(mock_tasklists_insert).toHaveBeenCalledTimes(2);
        expect(result.current).toBe('existing-c');
        expect(result.next).toBe('new-n');
        expect(result.done).toBe('new-d');
    });
});
