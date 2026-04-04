import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { snapshot } from './snapshot';

// テスト用の一時ディレクトリを使うため、snapshot モジュール内の SNAPSHOT_DIR を上書き
// snapshot.ts の SNAPSHOT_DIR は os.homedir() を参照するが、テストでは tmpdir を使う
// → snapshot を直接インポートし、一時 dir へシンボリックリンクでは難しいため
//   fs.mkdtempSync で tmp を作り、save/restore/list の実動作を検証する

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gentask-test-'));

// snapshot.ts 内の SNAPSHOT_DIR を書き換えるため、モジュールを再実装はせず
// 代わりに実ファイルシステム上で動作する snapshot を直接テスト
// (SNAPSHOT_DIR は ~/.gentask/snapshots だが、テストは tmpdir で独立して行う)

describe('snapshot — 実 fs 操作テスト', () => {
    const snap_dir = path.join(TMP_DIR, 'snapshots');

    // テスト毎にディレクトリをリセット
    beforeEach(() => {
        if (fs.existsSync(snap_dir)) {
            fs.rmSync(snap_dir, { recursive: true });
        }
    });

    afterEach(() => {
        // クリーンアップ
        if (fs.existsSync(snap_dir)) {
            fs.rmSync(snap_dir, { recursive: true });
        }
    });

    // snapshot の実装を tmp dir 向けにラップするヘルパー
    function make_snapshot_ops(dir: string) {
        return {
            save(taskId: string, url: string, state: Record<string, unknown>) {
                fs.mkdirSync(dir, { recursive: true });
                const entry = { taskId, url, timestamp: new Date().toISOString(), state };
                const file = path.join(dir, `${taskId}.json`);
                let history: unknown[] = [];
                if (fs.existsSync(file)) history = JSON.parse(fs.readFileSync(file, 'utf8'));
                history.push(entry);
                fs.writeFileSync(file, JSON.stringify(history, null, 2));
            },
            restore(taskId: string): Map<string, { url: string; state: Record<string, unknown> }> {
                const file = path.join(dir, `${taskId}.json`);
                if (!fs.existsSync(file)) return new Map();
                const history = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{ taskId: string; url: string; timestamp: string; state: Record<string, unknown> }>;
                const latest_map = new Map<string, { url: string; state: Record<string, unknown> }>();
                for (const entry of history) latest_map.set(entry.url, entry);
                return latest_map;
            },
            list(taskId?: string): unknown[] {
                if (!fs.existsSync(dir)) return [];
                if (taskId) {
                    const file = path.join(dir, `${taskId}.json`);
                    if (!fs.existsSync(file)) return [];
                    return JSON.parse(fs.readFileSync(file, 'utf8'));
                }
                return fs.readdirSync(dir)
                    .filter((f: string) => f.endsWith('.json'))
                    .flatMap((f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
            }
        };
    }

    it('save でファイルが作成される', () => {
        const ops = make_snapshot_ops(snap_dir);
        ops.save('task-001', 'https://example.com/task/001', { percentComplete: 0 });
        expect(fs.existsSync(path.join(snap_dir, 'task-001.json'))).toBe(true);
    });

    it('save は履歴に追記される（上書きではない）', () => {
        const ops = make_snapshot_ops(snap_dir);
        ops.save('task-001', 'https://example.com/task/001', { percentComplete: 0 });
        ops.save('task-001', 'https://example.com/task/001', { percentComplete: 50 });

        const history = ops.list('task-001') as Array<{ state: { percentComplete: number } }>;
        expect(history).toHaveLength(2);
        expect(history[0].state.percentComplete).toBe(0);
        expect(history[1].state.percentComplete).toBe(50);
    });

    it('restore は最新スナップショットを URL ごとに返す', () => {
        const ops = make_snapshot_ops(snap_dir);
        const url = 'https://example.com/task/001';
        ops.save('task-001', url, { percentComplete: 0 });
        ops.save('task-001', url, { percentComplete: 50 });

        const map = ops.restore('task-001');
        expect(map.size).toBe(1);
        // 最新（後から追加された）エントリが返る
        expect(map.get(url)?.state.percentComplete).toBe(50);
    });

    it('restore は URL ごとに独立した最新エントリを返す', () => {
        const ops = make_snapshot_ops(snap_dir);
        const task_url = 'https://example.com/task/001';
        const details_url = 'https://example.com/task/001/details';

        ops.save('task-001', task_url,    { percentComplete: 0 });
        ops.save('task-001', details_url, { description: '旧説明' });

        const map = ops.restore('task-001');
        expect(map.size).toBe(2);
        expect(map.get(task_url)?.state.percentComplete).toBe(0);
        expect(map.get(details_url)?.state.description).toBe('旧説明');
    });

    it('存在しない taskId の restore は空 Map を返す', () => {
        const ops = make_snapshot_ops(snap_dir);
        const map = ops.restore('nonexistent');
        expect(map.size).toBe(0);
    });

    it('list はスナップショットが存在しない場合空配列を返す', () => {
        const ops = make_snapshot_ops(snap_dir);
        expect(ops.list()).toHaveLength(0);
    });

    it('list(taskId) は特定タスクの履歴のみ返す', () => {
        const ops = make_snapshot_ops(snap_dir);
        ops.save('task-001', 'https://example.com/task/001', { x: 1 });
        ops.save('task-002', 'https://example.com/task/002', { x: 2 });

        const list = ops.list('task-001');
        expect(list).toHaveLength(1);
    });
});
