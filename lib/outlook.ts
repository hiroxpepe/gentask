import { graph } from './graph';
import { type gen_task, type outlook_event } from './types';

/** Open Extension の識別子 */
const EXTENSION_NAME = 'com.gentask.v1';

/**
 * @class OutlookService
 * @description Microsoft 365 Outlook カレンダーとのやり取りを担うサービス。
 * タスクに紐づくカレンダー予定の作成・取得・拡張属性の管理を行う。
 */
export class OutlookService {
    private readonly base_url = 'https://graph.microsoft.com/v1.0/me';

    /**
     * @method create_event
     * @description Planner タスクに対応する Outlook カレンダー予定を作成する。
     * @param task - デプロイされた gen_task オブジェクト
     * @param planner_task_id - 紐付ける Planner タスク ID
     * @param start_iso - 予定開始日時（ISO 8601）
     * @param end_iso   - 予定終了日時（ISO 8601）
     * @returns 作成された Outlook イベント ID
     */
    async create_event(
        task: gen_task,
        planner_task_id: string,
        start_iso: string,
        end_iso: string
    ): Promise<string> {
        const event_res = await graph.post(`${this.base_url}/events`, {
            subject: `[${task.mode}] ${task.title}`,
            body: {
                contentType: 'text',
                content: task.description
            },
            start: { dateTime: start_iso, timeZone: 'Asia/Tokyo' },
            end:   { dateTime: end_iso,   timeZone: 'Asia/Tokyo' },
        });

        // Open Extension で Planner タスク ID を紐付ける
        await this.add_extension(event_res.id, planner_task_id);

        return event_res.id as string;
    }

    /**
     * @method add_extension
     * @description Outlook イベントに Open Extension を追加し、Planner タスク ID を記録する。
     * @param event_id        - 対象の Outlook イベント ID
     * @param planner_task_id - 紐付ける Planner タスク ID
     */
    async add_extension(event_id: string, planner_task_id: string): Promise<void> {
        await graph.post(`${this.base_url}/events/${event_id}/extensions`, {
            '@odata.type': '#microsoft.graph.openTypeExtension',
            extensionName: EXTENSION_NAME,
            plannerTaskId: planner_task_id,
        });
    }

    /**
     * @method get_linked_events
     * @description gentask 拡張が付いた Outlook イベントを全件取得する。
     * @returns outlook_event の配列（extensions フィールド含む）
     */
    async get_linked_events(): Promise<outlook_event[]> {
        // $expand で extensions を同時取得し、拡張が存在するものだけに絞る
        const url =
            `${this.base_url}/events` +
            `?$expand=extensions($filter=id eq '${EXTENSION_NAME}')` +
            `&$filter=extensions/any(e:e/id eq '${EXTENSION_NAME}')` +
            `&$select=id,subject,body,start,end,extensions` +
            `&$top=50`;

        const res = await graph.get(url);
        return (res.value ?? []) as outlook_event[];
    }

    /**
     * @method get_event_status_input
     * @description 紐付きイベントと対応 Planner タスクの現在 percentComplete を組み合わせ、
     * sync_flow への入力リストを構築する。
     * @param linked_events - get_linked_events() の戻り値
     * @param planner_status_map - plannerTaskId → percentComplete のマップ
     */
    build_sync_inputs(
        linked_events: outlook_event[],
        planner_status_map: Map<string, number>
    ): Array<{
        outlookEventId: string;
        plannerTaskId: string;
        subject: string;
        bodyContent: string;
        currentStatus: number;
    }> {
        return linked_events.flatMap(event => {
            const ext = event.extensions?.find(e => e.id === EXTENSION_NAME);
            if (!ext?.plannerTaskId) return [];

            return [{
                outlookEventId: event.id,
                plannerTaskId: ext.plannerTaskId,
                subject: event.subject,
                bodyContent: event.body.content,
                currentStatus: planner_status_map.get(ext.plannerTaskId) ?? 0,
            }];
        });
    }
}
