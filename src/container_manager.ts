import { graph } from '../lib/graph';
import { type bucket_role } from '../lib/types';

/**
 * @class PlannerContainerManager
 * @description Microsoft 365 Planner のプランとバケットのコンテナ管理を担当する。
 * モードごとにプランと3つの標準バケット（今週分/来週分/完了）の存在を保証し、
 * 結果をキャッシュして重複作成を防ぐ。
 */
export class PlannerContainerManager {
    /** @private {Map} plan_cache - 実行中に生成したプランIDと3バケットIDを保持し、再利用を可能にする */
    private plan_cache = new Map<string, { plan_id: string, buckets: Record<bucket_role, string> }>();

    /** @private {string} current_timestamp - 命名規則 {MODE}_{YYYYMMDD}_{HHMM} に使用する実行時時刻 */
    private current_timestamp: string;

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

    /**
     * @method get_container
     * @description 特定のモードに対して、プランと3バケット（今週分/来週分/完了）が存在することを保証する。
     * @param {string} mode - タスクのモード (PTASK, TTASK, CTASK, ATASK)
     * @returns {Promise<object>} plan_id と buckets（bucket_role → bucket_id のマップ）を含むオブジェクト
     */
    async get_container(mode: string): Promise<{ plan_id: string, buckets: Record<bucket_role, string> }> {
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
