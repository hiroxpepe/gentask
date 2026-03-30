import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./graph', () => ({
    graph: {
        post:  vi.fn(),
        get:   vi.fn(),
        patch: vi.fn(),
    },
}));

import { graph } from './graph';
import { OutlookService } from './outlook';

const mock_post  = graph.post  as ReturnType<typeof vi.fn>;
const mock_get   = graph.get   as ReturnType<typeof vi.fn>;

describe('OutlookService.create_event', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('Outlook イベントを POST して ID を返す', async () => {
        mock_post.mockResolvedValueOnce({ id: 'event-001' }); // create event
        mock_post.mockResolvedValueOnce({ id: 'ext-001' });   // add extension

        const service = new OutlookService();
        const result = await service.create_event(
            { title: 'プロット', mode: 'PTASK', priority: 3, description: '説明', label: 'Green' },
            'planner-task-001',
            '2026-04-01T09:00:00.000Z',
            '2026-04-01T09:30:00.000Z'
        );

        expect(result).toBe('event-001');

        // イベント POST の確認
        const event_call = mock_post.mock.calls[0];
        expect((event_call[0] as string)).toContain('/me/events');
        expect((event_call[1] as { subject: string }).subject).toContain('プロット');
    });

    it('create_event は必ず add_extension も呼ぶ', async () => {
        mock_post.mockResolvedValueOnce({ id: 'event-002' });
        mock_post.mockResolvedValueOnce({ id: 'ext-002' });

        const service = new OutlookService();
        await service.create_event(
            { title: 'テスト', mode: 'CTASK', priority: 5, description: '説明', label: 'Blue' },
            'planner-task-002',
            '2026-04-02T10:00:00.000Z',
            '2026-04-02T10:30:00.000Z'
        );

        // 2回 post が呼ばれる（event + extension）
        expect(mock_post).toHaveBeenCalledTimes(2);

        // 2回目は extensions エンドポイントへの POST
        const ext_call = mock_post.mock.calls[1];
        expect((ext_call[0] as string)).toContain('/extensions');
        expect((ext_call[1] as { plannerTaskId: string }).plannerTaskId).toBe('planner-task-002');
    });
});

describe('OutlookService.add_extension', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('Open Extension を events/{id}/extensions に POST する', async () => {
        mock_post.mockResolvedValueOnce({});

        const service = new OutlookService();
        await service.add_extension('event-xyz', 'planner-task-xyz');

        expect(mock_post).toHaveBeenCalledTimes(1);
        const call = mock_post.mock.calls[0];
        expect((call[0] as string)).toContain('events/event-xyz/extensions');
        expect((call[1] as { extensionName: string }).extensionName).toBe('com.gentask.v1');
        expect((call[1] as { plannerTaskId: string }).plannerTaskId).toBe('planner-task-xyz');
    });
});

describe('OutlookService.build_sync_inputs', () => {
    it('plannerTaskId を持つイベントを sync_input に変換する', () => {
        const service = new OutlookService();
        const events = [
            {
                id: 'event-001',
                subject: '[PTASK] プロット',
                body: { contentType: 'text', content: 'ok' },
                start: { dateTime: '2026-04-01T09:00:00', timeZone: 'Asia/Tokyo' },
                end:   { dateTime: '2026-04-01T09:30:00', timeZone: 'Asia/Tokyo' },
                extensions: [{ id: 'com.gentask.v1', plannerTaskId: 'task-001' }],
            },
        ];
        const status_map = new Map([['task-001', 50]]);

        const result = service.build_sync_inputs(events, status_map);

        expect(result).toHaveLength(1);
        expect(result[0].outlookEventId).toBe('event-001');
        expect(result[0].plannerTaskId).toBe('task-001');
        expect(result[0].currentStatus).toBe(50);
    });

    it('拡張なしのイベントは除外される', () => {
        const service = new OutlookService();
        const events = [
            {
                id: 'event-002',
                subject: '普通の予定',
                body: { contentType: 'text', content: '' },
                start: { dateTime: '2026-04-01T10:00:00', timeZone: 'Asia/Tokyo' },
                end:   { dateTime: '2026-04-01T10:30:00', timeZone: 'Asia/Tokyo' },
                // extensions なし
            },
        ];

        const result = service.build_sync_inputs(events, new Map());
        expect(result).toHaveLength(0);
    });

    it('plannerTaskId が status_map にない場合は 0 を返す', () => {
        const service = new OutlookService();
        const events = [
            {
                id: 'event-003',
                subject: '[PTASK] テスト',
                body: { contentType: 'text', content: '' },
                start: { dateTime: '2026-04-01T09:00:00', timeZone: 'Asia/Tokyo' },
                end:   { dateTime: '2026-04-01T09:30:00', timeZone: 'Asia/Tokyo' },
                extensions: [{ id: 'com.gentask.v1', plannerTaskId: 'task-unknown' }],
            },
        ];

        const result = service.build_sync_inputs(events, new Map());
        expect(result[0].currentStatus).toBe(0);
    });
});
