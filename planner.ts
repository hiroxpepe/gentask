import { graph } from './graph';
import { type gen_task, type bucket_role } from './types';
import { OutlookService } from './outlook';

/** タスク 1 件あたりのデフォルト作業時間（30分 = 0.5sp）*/
const DEFAULT_BLOCK_MINUTES = 30;

/**
 * @class PlannerService
 * @description Microsoft 365 Planner 上にタスク構造を構築するサービス。
 * P/T/C/A モードごとにプランを 1 つに集約し、日次タイムスタンプで管理する。
 */
export class PlannerService {
    /** @private {string|undefined} m365_user_id - タスク割り当てに使用する実行ユーザーの ID */
    private m365_user_id = process.env.M365_USER_ID;

    /** @private {Map} plan_cache - 実行中に生成したプラン ID と3バケット ID を保持し、再利用を可能にする */
    private plan_cache = new Map<string, { plan_id: string, buckets: Record<bucket_role, string> }>();

    /** @private {string} current_timestamp - 命名規則 {MODE}_{YYYYMMDD}_{HHMM} に使用する実行時時刻 */
    private current_timestamp: string;

    /** @private {Date} deploy_start - デプロイ開始時刻。Outlook 予定の開始時刻の基準点として使用 */
    private deploy_start: Date;

    /** @private {OutlookService} outlook - Outlook カレンダー操作サービス */
    private outlook = new OutlookService();

    constructor() {
        const now = new Date();
        this.deploy_start = new Date(now);
        // YYYYMMDD_HHMM 形式の生成（例: 20260103_1830）
        this.current_timestamp =
            now.getFullYear().toString() +
            (now.getMonth() + 1).toString().padStart(2, '0') +
            now.getDate().toString().padStart(2, '0') + "_" +
            now.getHours().toString().padStart(2, '0') +
            now.getMinutes().toString().padStart(2, '0');
    }

    /** @private {Record} label_map - スキーマのラベル名から Planner API のカテゴリ番号へのマッピング表 */
    private label_map: Record<string, string> = {
        'Pink': 'category1', 'Red': 'category2', 'Yellow': 'category3',
        'Green': 'category4', 'Blue': 'category5', 'Purple': 'category6'
    };

    /**
     * @method execute_deployment
     * @description AI が生成した複数のタスクをループし、Planner と Outlook の双方に配置する。
     * 各タスクは 0.5sp（DEFAULT_BLOCK_MINUTES）単位で連続する Outlook 予定にマップされ、
     * Open Extension で Planner ↔ Outlook の永続 ID リンクが確立される。
     * @param {gen_task[]} tasks - 展開対象となるタスクオブジェクトの配列
     * @returns {Promise<void>}
     */
    async execute_deployment(tasks: gen_task[]): Promise<void> {
        // Outlook 予定の開始時刻カーソル（タスクごとにずらしていく）
        let slot_start = new Date(this.deploy_start);

        for (const task of tasks) {
            // 当該モード（P/T/C/A）に対応するプランとバケットを取得（なければ作成）
            const { plan_id, buckets } = await this.ensure_container(task.mode);

            // PTASK はデフォルト「来週分」、それ以外は「今週分」に配置。task.bucket で上書き可能
            const role: bucket_role = task.bucket ?? (task.mode === 'PTASK' ? 'next' : 'current');
            const bucket_id = buckets[role];

            console.log(`  [Deploying] Mode: ${task.mode} | Bucket: ${role} | Title: ${task.title}`);

            // 1. Planner タスクの物理作成
            const task_res = await graph.post(`https://graph.microsoft.com/v1.0/planner/tasks`, {
                planId: plan_id,
                bucketId: bucket_id,
                title: task.title,
                priority: task.priority,
                assignments: {
                    [this.m365_user_id!]: {
                        "@odata.type": "#microsoft.graph.plannerAssignment",
                        "orderHint": " !"
                    }
                },
                appliedCategories: { [this.label_map[task.label]]: true }
            });

            // 2. AI 生成の description を plannerTaskDetails に書き込む
            const details_url = `https://graph.microsoft.com/v1.0/planner/tasks/${task_res.id}/details`;
            const details_res = await graph.get(details_url);
            await graph.patch(details_url, { description: task.description }, {
                'If-Match': details_res['@odata.etag']
            });

            // 3. 対応する Outlook カレンダー予定を作成し、Open Extension で ID リンクを確立
            const slot_end = new Date(slot_start.getTime() + DEFAULT_BLOCK_MINUTES * 60 * 1000);
            const outlook_event_id = await this.outlook.create_event(
                task,
                task_res.id as string,
                slot_start.toISOString(),
                slot_end.toISOString()
            );

            // 4. Planner タスク側にも outlookEventId を Open Extension として記録
            await graph.post(
                `https://graph.microsoft.com/v1.0/planner/tasks/${task_res.id}/extensions`,
                {
                    '@odata.type': '#microsoft.graph.openTypeExtension',
                    extensionName: 'com.gentask.v1',
                    outlookEventId: outlook_event_id,
                }
            );

            console.log(`  [Linked]    Outlook event: ${outlook_event_id}`);

            // 次のタスク用にスロットを前進させる
            slot_start = slot_end;
        }
    }

    /**
     * @method ensure_container
     * @private
     * @description 特定のモードに対して、プランと3バケット（今週分/来週分/完了）が存在することを保証する。
     * @param {string} mode - タスクのモード (PTASK, TTASK, CTASK, ATASK)
     * @returns {Promise<object>} plan_id と buckets（bucket_role → bucket_id のマップ）を含むオブジェクト
     */
    private async ensure_container(mode: string): Promise<{ plan_id: string, buckets: Record<bucket_role, string> }> {
        // キャッシュに存在すれば、API 呼び出しをスキップして即復帰（プラン乱立防止）
        if (this.plan_cache.has(mode)) return this.plan_cache.get(mode)!;

        const group_id = process.env[`M365_PLANNER_${mode}_GROUP_ID`];
        // 指定された命名規則 {MODE}_{YYYYMMDD}_{HHMM} を適用
        const plan_title = `${mode}_${this.current_timestamp}`;

        // 1. 指定グループ内にプランを作成
        const plan_res = await graph.post(`https://graph.microsoft.com/v1.0/planner/plans`, {
            title: plan_title,
            container: {
                url: `https://graph.microsoft.com/v1.0/groups/${group_id}`,
                "@odata.type": "#microsoft.graph.plannerPlanContainer"
            }
        });

        // 2. 作成したプランの中に 3 バケットを作成（今週分・来週分・完了）
        const bucket_names: Record<bucket_role, string> = {
            current: '今週分',
            next:    '来週分',
            done:    '完了',
        };
        const bucket_ids = {} as Record<bucket_role, string>;
        for (const [role, name] of Object.entries(bucket_names) as [bucket_role, string][]) {
            const bucket_res = await graph.post(`https://graph.microsoft.com/v1.0/planner/buckets`, {
                name,
                planId: plan_res.id
            });
            bucket_ids[role] = bucket_res.id as string;
        }

        const result = { plan_id: plan_res.id, buckets: bucket_ids };
        // 次回の同一モード呼び出しのためにキャッシュ
        this.plan_cache.set(mode, result);
        return result;
    }
}