import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SNAPSHOT_DIR = path.join(os.homedir(), '.gentask', 'snapshots');

/**
 * @interface TaskSnapshot
 * @description 1 回のスナップショット記録。タスクの変更前状態を保持する。
 * uuid フィールドにより、move_task 後もスナップショットを追跡可能。
 */
export interface TaskSnapshot {
    uuid:      string;  // 不変 UUID（move_task を経ても変わらない）
    taskId:    string;  // 記録時点の Google Tasks タスク ID（変わりうる）
    listId:    string;  // 記録時点のリスト ID
    timestamp: string;  // ISO 8601
    state:     Record<string, unknown>;
}

/**
 * @namespace snapshot
 * @description タスクの変更前状態を ~/.gentask/snapshots/ にローカル JSON で記録する。
 * 各操作の直前に save() を呼び出すことで、undo トリガー時に 1 つ前の状態を復元できる。
 * ファイル名は不変 UUID をキーにするため、move_task によるタスク ID 変更後も追跡可能。
 */
export const snapshot = {
    /**
     * @method save
     * @description タスク状態をスナップショットとして追記保存する。
     * ファイル名は uuid をキーにする（taskId ではない）。
     * @param uuid   不変 UUID
     * @param taskId 現在の Google Tasks タスク ID
     * @param listId 現在のリスト ID
     * @param state  保存する現在状態オブジェクト
     */
    save(uuid: string, taskId: string, listId: string, state: Record<string, unknown>): void {
        fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

        const entry: TaskSnapshot = {
            uuid,
            taskId,
            listId,
            timestamp: new Date().toISOString(),
            state,
        };

        const file = path.join(SNAPSHOT_DIR, `${uuid}.json`);
        let history: TaskSnapshot[] = [];
        if (fs.existsSync(file)) {
            history = JSON.parse(fs.readFileSync(file, 'utf8')) as TaskSnapshot[];
        }
        history.push(entry);
        fs.writeFileSync(file, JSON.stringify(history, null, 2));
    },

    /**
     * @method restore
     * @description 指定 UUID の直前スナップショット（最新）を返す。
     * 呼び出し側はこの結果を使い、tasks.tasks.update でロールバックを実施する。
     * @param uuid 不変 UUID
     * @returns 最新の TaskSnapshot、存在しなければ null
     */
    restore(uuid: string): TaskSnapshot | null {
        const file = path.join(SNAPSHOT_DIR, `${uuid}.json`);
        if (!fs.existsSync(file)) return null;

        const history = JSON.parse(fs.readFileSync(file, 'utf8')) as TaskSnapshot[];
        if (history.length === 0) return null;
        return history[history.length - 1]; // 末尾が最新
    },

    /**
     * @method list_snapshots
     * @description 保存済みスナップショットを返す。
     * @param uuid 省略時は全タスク分を返す
     */
    list_snapshots(uuid?: string): TaskSnapshot[] {
        if (!fs.existsSync(SNAPSHOT_DIR)) return [];

        if (uuid) {
            const file = path.join(SNAPSHOT_DIR, `${uuid}.json`);
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
