import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SNAPSHOT_DIR = path.join(os.homedir(), '.gentask', 'snapshots');

/**
 * @interface TaskSnapshot
 * @description 1 回のスナップショット記録。タスクまたは詳細の変更前状態を保持する。
 */
export interface TaskSnapshot {
    taskId:    string;
    url:       string;    // スナップショット対象の Graph API エンドポイント
    timestamp: string;    // ISO 8601
    state:     Record<string, unknown>;
}

/**
 * @namespace snapshot
 * @description Planner タスクの変更前状態を ~/.gentask/snapshots/ にローカル JSON で記録する。
 * PATCH 操作の直前に save() を呼び出すことで、undo トリガー時に 1 つ前の状態を復元できる。
 */
export const snapshot = {
    /**
     * @method save
     * @description タスク状態をスナップショットとして追記保存する。
     * @param taskId - Planner タスク ID
     * @param url    - 対象エンドポイント URL（タスク本体 or 詳細）
     * @param state  - 保存する現在状態オブジェクト
     */
    save(taskId: string, url: string, state: Record<string, unknown>): void {
        fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

        const entry: TaskSnapshot = {
            taskId,
            url,
            timestamp: new Date().toISOString(),
            state,
        };

        const file = path.join(SNAPSHOT_DIR, `${taskId}.json`);
        let history: TaskSnapshot[] = [];
        if (fs.existsSync(file)) {
            history = JSON.parse(fs.readFileSync(file, 'utf8')) as TaskSnapshot[];
        }
        history.push(entry);
        fs.writeFileSync(file, JSON.stringify(history, null, 2));
    },

    /**
     * @method restore
     * @description 指定タスクの直前スナップショット一覧を返す（URL ごとの最新エントリ）。
     * 呼び出し側はこの結果を使い、各 URL に PATCH を発行してロールバックを実施する。
     * @param taskId - Planner タスク ID
     * @returns URL → スナップショットのマップ。スナップショット未存在なら空 Map
     */
    restore(taskId: string): Map<string, TaskSnapshot> {
        const file = path.join(SNAPSHOT_DIR, `${taskId}.json`);
        if (!fs.existsSync(file)) return new Map();

        const history = JSON.parse(fs.readFileSync(file, 'utf8')) as TaskSnapshot[];
        // URL ごとに最新エントリを 1 つだけ取得する（配列末尾が最新）
        const latest_map = new Map<string, TaskSnapshot>();
        for (const entry of history) {
            latest_map.set(entry.url, entry);
        }
        return latest_map;
    },

    /**
     * @method list_snapshots
     * @description 保存済みスナップショットを返す。
     * @param taskId - 省略時は全タスク分を返す
     */
    list_snapshots(taskId?: string): TaskSnapshot[] {
        if (!fs.existsSync(SNAPSHOT_DIR)) return [];

        if (taskId) {
            const file = path.join(SNAPSHOT_DIR, `${taskId}.json`);
            if (!fs.existsSync(file)) return [];
            return JSON.parse(fs.readFileSync(file, 'utf8')) as TaskSnapshot[];
        }

        return fs.readdirSync(SNAPSHOT_DIR)
            .filter(f => f.endsWith('.json'))
            .flatMap(f =>
                JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf8')) as TaskSnapshot[]
            );
    },
};
