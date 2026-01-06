import { graph } from './graph';
import { gen_task } from './index';

/**
 * @class PlannerService
 * @description Microsoft 365 Planner 上にタスク構造を構築するサービス。
 * P/T/C/A モードごとにプランを 1 つに集約し、日次タイムスタンプで管理する。
 */
export class PlannerService {
    /** @private {string|undefined} m365_user_id - タスク割り当てに使用する実行ユーザーの ID */
    private m365_user_id = process.env.M365_USER_ID;

    /** @private {Map} plan_cache - 実行中に生成したプラン ID とバケット ID を保持し、再利用を可能にする */
    private plan_cache = new Map<string, { plan_id: string, bucket_id: string }>();

    /** @private {string} current_timestamp - 命名規則 {MODE}_{YYYYMMDD}_{HHMM} に使用する実行時時刻 */
    private current_timestamp: string;

    /**
     * @constructor
     * @description 実行時のタイムスタンプを生成し、インスタンスを初期化する。
     */
    constructor() {
        const now = new Date();
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
     * @description AI が生成した複数のタスクをループし、適切な Planner プランへ配置する。
     * @param {gen_task[]} tasks - 展開対象となるタスクオブジェクトの配列
     * @returns {Promise<void>}
     */
    async execute_deployment(tasks: gen_task[]): Promise<void> {
        for (const task of tasks) {
            // 当該モード（P/T/C/A）に対応するプランとバケットを取得（なければ作成）
            const { plan_id, bucket_id } = await this.ensure_container(task.mode);

            console.log(`  [Deploying] Mode: ${task.mode} | Title: ${task.title}`);

            // タスクの物理作成
            await graph.post(`https://graph.microsoft.com/v1.0/planner/tasks`, {
                planId: plan_id,
                bucketId: bucket_id,
                title: task.title,
                priority: task.priority,
                // 実行ユーザーにタスクを自動割り当て
                assignments: {
                    [this.m365_user_id!]: {
                        "@odata.type": "#microsoft.graph.plannerAssignment",
                        "orderHint": " !"
                    }
                },
                // スキーマで指定されたカラーラベルを適用
                appliedCategories: { [this.label_map[task.label]]: true }
            });
        }
    }

    /**
     * @method ensure_container
     * @private
     * @description 特定のモードに対して、プランと "To Do" バケットが 1 つだけ存在することを保証する。
     * @param {string} mode - タスクのモード (PTASK, TTASK, CTASK, ATASK)
     * @returns {Promise<object>} plan_id と bucket_id を含むオブジェクト
     */
    private async ensure_container(mode: string): Promise<{ plan_id: string, bucket_id: string }> {
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

        // 2. 作成したプランの中に "To Do" バケットを作成
        const bucket_res = await graph.post(`https://graph.microsoft.com/v1.0/planner/buckets`, {
            name: "To Do",
            planId: plan_res.id
        });

        const result = { plan_id: plan_res.id, bucket_id: bucket_res.id };
        // 次回の同一モード呼び出しのためにキャッシュ
        this.plan_cache.set(mode, result);
        return result;
    }
}