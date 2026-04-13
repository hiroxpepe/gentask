# Gentask 強化改修計画 — develop_plan_3

> **根拠ドキュメント:** `docs/05_memo.md`（アーキテクチャ忖度ゼロレビュー）
>
> **目的:** `05_memo.md` が指摘した 5 つの致命的構造問題を根本解決し、CLIの安定稼働を完成させた後、GCP による完全無人化を実現する。
>
> **前提:** `develop_plan_2_details.md`（Phase 0〜6）の実装が完了しており、全テストが通過していること。

---

## 問題マップと解決フェーズの対応

| # | 問題（05_memo.md） | 解決フェーズ | 影響ファイル |
|:--|:---|:---|:---|
| 1 | `move_task` によるID消失・スナップショット崩壊・リンク切れ | Phase 8 | `lib/types.ts`, `lib/snapshot.ts`, `bin/slide.ts`, `bin/sync.ts` |
| 2 | 2週間スコープで生まれるゾンビタスク | Phase 9 | `bin/sync.ts` |
| 3 | ハードコード文字列一致（「プロット」「ネーム」「投稿」）の脆弱性 | Phase 7 | `lib/types.ts`, `bin/slide.ts`, `bin/index.ts` |
| 4 | `notes` 末尾JSON埋め込みというヒューマンエラー時限爆弾 | Phase 8 | `lib/types.ts`, `bin/slide.ts`, `bin/sync.ts`, `bin/index.ts` |
| 5 | 手動CLI実行が最大の精神的摩耗 | Phase 10 | `Dockerfile`, `.github/workflows/`, GCP設定 |

---

## フェーズ概要

```
Phase 7  sub_role enum化
  └─ 問題3（文字列一致）を根本解決

Phase 8  UUID永続ID導入
  └─ 問題1（ID消失）+ 問題4（notes JSON）を根本解決

Phase 9  ゾンビタスク対応
  └─ 問題2（2週間スコープ）を根本解決

Phase 10  GCP完全無人化
  └─ 問題5（手動CLI）を根本解決
```

---

## Phase 7: sub_role enum 化

**目標:** 「プロット」「ネーム」「投稿」などの**タイトル文字列一致**による判定を完全廃止し、
AI が生成時に厳密な `sub_role` enum を付与する設計へ変更する。

**完了条件:** `TZ=Asia/Tokyo npm test` で全テストが通過すること。文字列 `'プロット'` `'ネーム'` `'投稿'` の検索・分岐ロジックがコードから 0 件になること。

---

### タスク 7-1: `lib/types.ts` — `sub_role` フィールドを `task_schema` に追加

**変更箇所:** `task_schema` の `z.object({...})` 内に以下のフィールドを追加する。

```typescript
// 追加するフィールド
sub_role: z.enum(['plot', 'name', 'post', 'other']).default('other')
    .describe(`タスクの工程ロール（スケジューリングとスライド判定に使用）：
  - plot:  プロット作業（PTASK。水14:00・木14:00 に自動配置）
  - name:  ネーム/ラフ作業（PTASK。金14:00 に自動配置）
  - post:  投稿作業（CTASK。スライド前の完了チェック対象）
  - other: 上記以外（翌月曜 09:00 から 30 分ブロック順次配置）`),
```

**変更後の `task_schema` 全体像:**
```typescript
export const task_schema = z.object({
    title:    z.string().min(1).max(255)...,
    mode:     z.enum(['PTASK', 'TTASK', 'CTASK', 'ATASK'])...,
    sub_role: z.enum(['plot', 'name', 'post', 'other']).default('other')...,  // ← NEW
    priority: z.number().min(1).max(9).default(5)...,
    description: z.string()...,
    label:    z.enum(['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Pink'])...,
    bucket:   z.enum(['current', 'next']).optional()...,
});
export type gen_task = z.infer<typeof task_schema>;
```

**注意事項:**
- `label` フィールドは M365 残滓だが、このフェーズでは削除せずメモ用途として温存する。
- `sub_role` のデフォルトは `'other'` にすることで、既存データとの後方互換を保つ。

---

### タスク 7-2: `bin/slide.ts` — `PLANNING_SCHEDULE` を sub_role ベースに変更

**現在の実装（問題）:**
```typescript
export const PLANNING_SCHEDULE: Record<string, { day: number; hour: number; blocks: number }[]> = {
    'プロット': [
        { day: 3, hour: 14, blocks: 2 },
        { day: 4, hour: 14, blocks: 2 },
    ],
    'ネーム': [
        { day: 5, hour: 14, blocks: 2 },
    ],
};
```

**変更後の実装:**
```typescript
// import に sub_role 型を追加
import { task_schema, type bucket_role, type gen_task } from '../lib/types';
// sub_role 型を取得するため
type SubRole = gen_task['sub_role'];

export const PLANNING_SCHEDULE: Partial<Record<SubRole, { day: number; hour: number; blocks: number }[]>> = {
    'plot': [
        { day: 3, hour: 14, blocks: 2 }, // 水 14:00〜15:00
        { day: 4, hour: 14, blocks: 2 }, // 木 14:00〜15:00
    ],
    'name': [
        { day: 5, hour: 14, blocks: 2 }, // 金 14:00〜15:00
    ],
    // 'post' と 'other' はデフォルトスロット（月曜 09:00 順次）
};
```

---

### タスク 7-3: `bin/slide.ts` — `GoogleTaskItem` に `sub_role` フィールドを追加

**現在の `GoogleTaskItem` インターフェース:**
```typescript
export interface GoogleTaskItem {
    id:      string;
    title:   string;
    notes?:  string;
    status:  'needsAction' | 'completed';
    due?:    string;
    listId:  string;
}
```

**変更後:**
```typescript
// lib/types.ts から SubRole 型をインポート
type SubRole = gen_task['sub_role'];

export interface GoogleTaskItem {
    id:       string;
    title:    string;
    notes?:   string;
    status:   'needsAction' | 'completed';
    due?:     string;
    listId:   string;
    sub_role: SubRole; // ← NEW（デフォルト 'other'）
}
```

**`get_tasks_in_list` の変更点:**
Google Tasks API は `notes` にシリアライズされた JSON を格納するため（Phase 8 で整備）、
このフェーズでは `notes` から `sub_role` を解析する暫定ロジックを実装する。

```typescript
// Phase 7 暫定ロジック（Phase 8 でメタデータ解析に統合される）
function extract_sub_role(notes?: string): SubRole {
    // Phase 8 実装前はタイトルから推定する fallback
    // ※ このロジック自体は Phase 8 で廃止され、メタデータから読む形に置換される
    return 'other';
}

// get_tasks_in_list の戻り値マッピング部分
return (res.data.items ?? []).map(t => ({
    id:       t.id!,
    title:    t.title ?? '',
    notes:    t.notes ?? undefined,
    status:   (t.status as 'needsAction' | 'completed') ?? 'needsAction',
    due:      t.due ?? undefined,
    listId:   list_id,
    sub_role: extract_sub_role(t.notes ?? undefined), // ← NEW
}));
```

---

### タスク 7-4: `bin/slide.ts` — `get_schedule_key` を廃止し `sub_role` で直接分岐

**廃止する関数:**
```typescript
// この関数を削除する
function get_schedule_key(title: string): string | undefined {
    return Object.keys(PLANNING_SCHEDULE).find(k => title.includes(k));
}
```

**`schedule_promoted_tasks` 内の分岐変更:**

```typescript
// Before（タイトル文字列一致）
const schedule_key = get_schedule_key(task.title);
if (schedule_key) {
    for (const slot of PLANNING_SCHEDULE[schedule_key]) {
        ...
    }
}

// After（sub_role による分岐）
const schedule_slots = PLANNING_SCHEDULE[task.sub_role];
if (schedule_slots && schedule_slots.length > 0) {
    for (const slot of schedule_slots) {
        ...
    }
} else {
    // 'post' および 'other' はデフォルトスロット
    ...
}
```

---

### タスク 7-5: `bin/slide.ts` — `archive_current_week` の投稿チェックを sub_role ベースに変更

**現在の実装（問題）:**
```typescript
// CTASK のみ「投稿」タスクの完了を確認する
if (mode === 'CTASK') {
    const post_task = tasks.find(t => t.title.includes('投稿')); // ← 文字列一致！
    ...
}
```

**変更後の実装:**
```typescript
if (mode === 'CTASK') {
    const post_task = tasks.find(t => t.sub_role === 'post'); // ← sub_role で判定
    if (!post_task) {
        console.warn('  [Archive] sub_role: post のタスクが見つかりません。スライドをスキップします。');
        return false;
    }
    if (post_task.status !== 'completed') {
        console.warn(`  [Archive] 投稿タスク「${post_task.title}」が未完了。スライドをスキップします。`);
        return false;
    }
}
```

---

### タスク 7-6: `bin/index.ts` — AI プロンプトを更新し sub_role を必ず付与させる

**現在のプロンプト（問題）:**
```typescript
prompt: `あなたは超一流のマネージャーです。「${input_subject}」という目標を達成するために必要な具体的タスクを、
        P(戦略)・T(技術)・C(制作)・A(事務) の全方位から網羅的に分解して出力してください。`,
```

**変更後のプロンプト:**
```typescript
prompt: `あなたは週刊漫画連載の超一流マネージャーです。「${input_subject}」を達成するために必要な具体的タスクを、
P(戦略)・T(技術)・C(制作)・A(事務) の全方位から網羅的に分解して出力してください。

sub_role の設定ルール（厳守）：
- プロット作業（脚本・シナリオ・構成・言語化）→ "plot"
- ネーム・ラフ・コマ割り作業 → "name"
- 投稿・アップロード・公開作業（CTASK のみ） → "post"
- 上記以外のすべての作業 → "other"

sub_role は必ず上記 4 種類のいずれかを設定すること。タイトルに「プロット」「ネーム」「投稿」という
単語が含まれるかどうかではなく、作業の本質に基づいて分類すること。`,
```

---

### タスク 7-7: `bin/slide.ts` — `generate_next_plot` のプロンプトを更新し sub_role を必ず付与させる

**変更後のプロンプト:**
```typescript
prompt: `あなたは週刊漫画の連載管理AIです。「${episode_hint}」の次回エピソードのプロット作業を
4つの 0.5sp（30分）タスクに分解してください。
各タスクは PTASK（企画・言語化）として、具体的で実行可能なタイトルと詳細を持つこと。
sub_role は必ず "plot" に設定すること（プロット作業タスクのため）。`,
```

---

### タスク 7-8: テストの更新

**`lib/types.test.ts` の変更:**
- `task_schema` の有効値テストに `sub_role: 'plot'` などを追加（計 5 種 × 4 sub_role）。
- `sub_role` 省略時にデフォルト `'other'` が設定されることを確認するテストを追加。

**`bin/slide.test.ts` の変更:**
- `archive_current_week` のモックタスクに `sub_role: 'post'` / `sub_role: 'other'` を追加。
- 投稿チェックのテストを `sub_role === 'post'` ベースに書き換え。
- `schedule_promoted_tasks` のテストで、`sub_role: 'plot'` のタスクが水・木曜に配置されることを確認。
- `schedule_promoted_tasks` のテストで、`sub_role: 'other'` のタスクが月曜スロットに配置されることを確認。
- 既存の文字列一致（`title.includes('プロット')`）に依存したテストをすべて削除。

---

## Phase 8: UUID 永続 ID 導入

**目標:** `move_task`（insert + delete）でタスク ID が変わっても追跡可能な**不変 UUID** を全タスクに付与し、スナップショット・双方向リンクが ID 変更に対して堅牢になる設計に変更する。
あわせて、`notes` 末尾 JSON の読み取りをエラートレラントに改善する。

**完了条件:**
- `move_task` 実行前後で `gentask_uuid` が変わらないことを確認するテストが通過すること。
- `notes` の末尾 JSON が壊れている場合でも `sync` がクラッシュしないことを確認するテストが通過すること。

---

### タスク 8-1: `uuid` パッケージの追加

```bash
npm install uuid
npm install --save-dev @types/uuid
```

---

### タスク 8-2: `lib/types.ts` — `GentaskMetadata` 型を追加

```typescript
import { v4 as uuidv4 } from 'uuid';

/**
 * @interface GentaskMetadata
 * @description Google Tasks の notes フィールド末尾に埋め込む Gentask 管理メタデータ。
 * uuid は不変のため、move_task によるID変更後も追跡に使用できる。
 */
export interface GentaskMetadata {
    uuid:       string; // 不変 UUID（v4）。move_task を経ても変わらない。
    eventId:    string; // Google Calendar イベント ID
    calendarId: string; // Google Calendar ID
    listId:     string; // Google Tasks リスト ID（move_task 後に更新される）
    sub_role:   string; // タスクの工程ロール（Phase 7 で導入した enum 値）
}

/** メタデータタグのプレフィックス */
export const GENTASK_TAG = '[gentask:';

/**
 * @function generate_gentask_uuid
 * @description Gentask 管理用の不変 UUID を生成する。
 */
export function generate_gentask_uuid(): string {
    return uuidv4();
}

/**
 * @function encode_gentask_metadata
 * @description GentaskMetadata を notes 埋め込み文字列にシリアライズする。
 * @param metadata 埋め込むメタデータ
 * @returns `[gentask:{...}]` 形式の文字列
 */
export function encode_gentask_metadata(metadata: GentaskMetadata): string {
    return `${GENTASK_TAG}${JSON.stringify(metadata)}]`;
}

/**
 * @function decode_gentask_metadata
 * @description notes 文字列から GentaskMetadata を抽出する。
 * JSON が壊れている・タグが存在しない場合は null を返す（クラッシュしない）。
 * @param notes Google Tasks タスクの notes フィールド文字列
 * @returns 解析成功時は GentaskMetadata、失敗時は null
 */
export function decode_gentask_metadata(notes: string | undefined | null): GentaskMetadata | null {
    if (!notes) return null;
    try {
        const tag_start = notes.lastIndexOf(GENTASK_TAG);
        if (tag_start === -1) return null;

        const json_start = tag_start + GENTASK_TAG.length;
        const json_end   = notes.indexOf(']', json_start);
        if (json_end === -1) return null;

        const json_str = notes.slice(json_start, json_end);
        const parsed   = JSON.parse(json_str) as Partial<GentaskMetadata>;

        // uuid が存在しない旧形式のデータはマイグレーション対象として null を返す
        if (!parsed.uuid || !parsed.eventId || !parsed.calendarId || !parsed.listId) {
            return null;
        }
        return parsed as GentaskMetadata;
    } catch {
        // JSON パースエラー：ユーザーがノートを手動編集して破損した場合
        console.warn('[Gentask] メタデータの解析に失敗しました。notes を確認してください。');
        return null;
    }
}

/**
 * @function strip_gentask_metadata
 * @description notes から Gentask メタデータタグを除去した純粋なテキストを返す。
 * ユーザーが読む/書くのはこの部分のみ。
 * @param notes Google Tasks タスクの notes フィールド文字列
 * @returns メタデータタグを除去した notes
 */
export function strip_gentask_metadata(notes: string | undefined | null): string {
    if (!notes) return '';
    const tag_start = notes.lastIndexOf(GENTASK_TAG);
    if (tag_start === -1) return notes;
    return notes.slice(0, tag_start).trimEnd();
}
```

---

### タスク 8-3: `lib/snapshot.ts` — キーを UUID ベースに変更

**現在の問題:** `snapshot.ts` は `taskId`（Google Tasks が発行する ID）をキーにしており、
`move_task` で ID が変わった瞬間に過去のスナップショットが孤立する。

**変更方針:** ファイル名とキーを `uuid`（不変）ベースに変更する。
`url` フィールドは Google 化後に意味をなさないため `listId` にリネームする。

**変更後の `snapshot.ts` 全体:**

```typescript
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
```

---

### タスク 8-4: `bin/index.ts` — タスク生成時に UUID を付与し双方向リンクを確立

**変更箇所:** `is_main` ブロック内のタスク生成・イベント作成ループ。

**変更前（現在）:**
```typescript
const task_res = await tasks_client.tasks.insert({
    tasklist: list_id,
    requestBody: {
        title: task.title,
        notes: task.description,
    },
});
const task_id = task_res.data.id!;

const event_res = await cal_client.events.insert({
    calendarId: calendar_id,
    requestBody: {
        summary: `[${task.mode}] ${task.title}`,
        description: task.description,
        start: { dateTime: start_dt.toISOString() },
        end:   { dateTime: end_dt.toISOString() },
        extendedProperties: {
            private: {
                gentask_taskId: task_id,
                gentask_listId: list_id,
            },
        },
    },
});
const event_id = event_res.data.id!;

// notes に双方向リンクを後付けで埋め込む（旧形式）
await tasks_client.tasks.update({
    tasklist: list_id,
    task:     task_id,
    requestBody: {
        id: task_id,
        notes: `${task.description}\n[gentask:{"eventId":"${event_id}","calendarId":"${calendar_id}","listId":"${list_id}"}]`,
    },
});
```

**変更後（UUID 付き新形式）:**
```typescript
import { generate_gentask_uuid, encode_gentask_metadata } from '../lib/types';

// UUID を先に生成（以降ずっと不変）
const gentask_uuid = generate_gentask_uuid();

// 1. Google Tasks にタスク作成（notes は一旦 description のみ）
const task_res = await tasks_client.tasks.insert({
    tasklist: list_id,
    requestBody: {
        title: task.title,
        notes: task.description,
    },
});
const task_id = task_res.data.id!;

// 2. Google Calendar にイベント作成
//    extendedProperties に uuid も追加することで Calendar 側から UUID 逆引き可能にする
const event_res = await cal_client.events.insert({
    calendarId: calendar_id,
    requestBody: {
        summary: `[${task.mode}] ${task.title}`,
        description: task.description,
        start: { dateTime: start_dt.toISOString() },
        end:   { dateTime: end_dt.toISOString() },
        extendedProperties: {
            private: {
                gentask_uuid:   gentask_uuid, // ← NEW: 不変UUID
                gentask_taskId: task_id,
                gentask_listId: list_id,
            },
        },
    },
});
const event_id = event_res.data.id!;

// 3. タスクの notes に完全なメタデータを埋め込む
const metadata = encode_gentask_metadata({
    uuid:       gentask_uuid,
    eventId:    event_id,
    calendarId: calendar_id,
    listId:     list_id,
    sub_role:   task.sub_role ?? 'other',
});
await tasks_client.tasks.update({
    tasklist: list_id,
    task:     task_id,
    requestBody: {
        id:    task_id,
        notes: `${task.description}\n${metadata}`,
    },
});

console.log(`  ✅ [${task.mode}/${task.sub_role}] ${task.title} (uuid: ${gentask_uuid})`);
```

---

### タスク 8-5: `bin/slide.ts` — `move_task` を UUID 保持対応に変更

**変更方針:** `move_task` 実行時に `notes` の UUID を維持し、移動後の新しい `listId` でメタデータを更新する。

**変更後の `move_task` 関数:**

```typescript
import {
    decode_gentask_metadata,
    encode_gentask_metadata,
    strip_gentask_metadata,
} from '../lib/types';
import { snapshot } from '../lib/snapshot';

async function move_task(
    task: GoogleTaskItem,
    source_list_id: string,
    target_list_id: string,
    auth: any,
    overrides?: Partial<Pick<GoogleTaskItem, 'due'>>
): Promise<GoogleTaskItem> {
    const tasks_client = google.tasks({ version: 'v1', auth });

    // 既存メタデータを解析
    const existing_meta = decode_gentask_metadata(task.notes);
    const pure_notes    = strip_gentask_metadata(task.notes);

    // スナップショット保存（移動前の状態を uuid キーで保存）
    if (existing_meta) {
        snapshot.save(
            existing_meta.uuid,
            task.id,
            source_list_id,
            {
                status: task.status,
                due:    task.due,
                notes:  task.notes,
                listId: source_list_id,
            }
        );
    }

    // 1. ターゲットリストにタスクを新規作成
    //    メタデータの listId を target_list_id に更新して引き継ぐ
    const updated_meta = existing_meta
        ? encode_gentask_metadata({ ...existing_meta, listId: target_list_id })
        : null;

    const new_notes = updated_meta
        ? (pure_notes ? `${pure_notes}\n${updated_meta}` : updated_meta)
        : task.notes;

    const inserted = await tasks_client.tasks.insert({
        tasklist: target_list_id,
        requestBody: {
            title:  task.title,
            notes:  new_notes,
            due:    overrides?.due ?? task.due,
            status: task.status,
        },
    });

    // 2. ソースリストから削除
    await tasks_client.tasks.delete({
        tasklist: source_list_id,
        task:     task.id,
    });

    const new_task_id = inserted.data.id!;

    // 3. Calendar の extendedProperties も新しい taskId・listId に更新する
    //    （メタデータから eventId・calendarId を取得可能な場合のみ）
    if (existing_meta) {
        const cal_client = google.calendar({ version: 'v3', auth });
        try {
            await cal_client.events.patch({
                calendarId: existing_meta.calendarId,
                eventId:    existing_meta.eventId,
                requestBody: {
                    extendedProperties: {
                        private: {
                            gentask_uuid:   existing_meta.uuid,
                            gentask_taskId: new_task_id,
                            gentask_listId: target_list_id,
                        },
                    },
                },
            });
        } catch (err) {
            // Calendar 更新失敗はログのみ（孤立タスクにはならない：uuid で逆引き可能）
            console.warn(`  [Move] Calendar 更新失敗 (uuid: ${existing_meta.uuid}):`, err);
        }
    }

    return {
        id:       new_task_id,
        title:    inserted.data.title ?? task.title,
        notes:    inserted.data.notes ?? undefined,
        status:   (inserted.data.status as 'needsAction' | 'completed') ?? 'needsAction',
        due:      inserted.data.due ?? undefined,
        listId:   target_list_id,
        sub_role: task.sub_role,
    };
}
```

**重要ポイント:**
- UUID は不変のため、`move_task` 後もスナップショットを UUID で追跡できる。
- Calendar の `extendedProperties` を `patch` で新しい `taskId` / `listId` に更新する。
- Calendar 更新が失敗しても、UUID があれば将来的な逆引きで修復可能。

---

### タスク 8-6: `bin/slide.ts` — `schedule_promoted_tasks` のメタデータ埋め込みを新形式に統一

**変更前（旧形式）:**
```typescript
notes: `${prev_notes}\n[gentask:{"eventId":"${event_id}","calendarId":"${calendar_id}","listId":"${task.listId}"}]`,
```

**変更後（新形式・UUID 付き）:**
```typescript
import {
    decode_gentask_metadata,
    encode_gentask_metadata,
    strip_gentask_metadata,
} from '../lib/types';

// schedule_promoted_tasks 内のメタデータ更新部分
const existing_meta = decode_gentask_metadata(task.notes);
const pure_notes    = strip_gentask_metadata(task.notes);
const new_uuid      = existing_meta?.uuid ?? generate_gentask_uuid();

const new_meta = encode_gentask_metadata({
    uuid:       new_uuid,
    eventId:    event_id,
    calendarId: calendar_id,
    listId:     task.listId,
    sub_role:   task.sub_role,
});

await tasks_client.tasks.update({
    tasklist: task.listId,
    task:     task.id,
    requestBody: {
        id:    task.id,
        notes: pure_notes ? `${pure_notes}\n${new_meta}` : new_meta,
    },
});
```

---

### タスク 8-7: `bin/sync.ts` — UUID ベースの undo・スナップショット参照に変更

**`apply_actions` の `undo` ケース変更:**

```typescript
case 'undo': {
    // メタデータから UUID を取得
    const task_info = await tasks_client.tasks.get({
        tasklist: list_id,
        task:     task_id,
    });
    const meta = decode_gentask_metadata(task_info.data.notes);

    if (!meta) {
        console.warn(`  [Undo] メタデータが見つかりません。Task: ${task_id}`);
        break;
    }

    const snap = snapshot.restore(meta.uuid); // UUID でスナップショットを取得
    if (!snap) {
        console.warn(`  [Undo] スナップショットが見つかりません。UUID: ${meta.uuid}`);
        break;
    }

    // スナップショット時点の状態に戻す
    await tasks_client.tasks.update({
        tasklist: list_id,
        task:     task_id,
        requestBody: { id: task_id, ...snap.state },
    });
    console.log(`  [Undo] UUID: ${meta.uuid} → 状態を ${snap.timestamp} に復元`);
    break;
}
```

**`apply_actions` の `complete` / `reschedule` / `add_note` / `buffer_consumed` ケース:**
各ケースの冒頭に、操作前のスナップショット保存を追加する。

```typescript
// 操作前スナップショット（共通）
const task_info = await tasks_client.tasks.get({ tasklist: list_id, task: task_id });
const meta = decode_gentask_metadata(task_info.data.notes);
if (meta) {
    snapshot.save(meta.uuid, task_id, list_id, {
        status: task_info.data.status,
        due:    task_info.data.due,
        notes:  task_info.data.notes,
    });
}
```

---

### タスク 8-8: `get_tasks_in_list` の sub_role 抽出ロジックを Phase 7 暫定から本実装に更新

Phase 7 で暫定実装した `extract_sub_role(notes)` を、
Phase 8 で導入した `decode_gentask_metadata` を使う本実装に差し替える。

```typescript
// Phase 8 本実装
function extract_sub_role_from_notes(notes?: string): SubRole {
    const meta = decode_gentask_metadata(notes);
    // メタデータに sub_role があればそれを使う。なければ 'other'
    if (meta && (meta.sub_role as SubRole)) {
        return meta.sub_role as SubRole;
    }
    return 'other';
}
```

---

### タスク 8-9: テストの更新

**`lib/types.test.ts` の追加テスト:**
- `encode_gentask_metadata` で生成した文字列が `decode_gentask_metadata` で正しく復元できること。
- `notes` 末尾の JSON が壊れている場合（`[gentask:{broken}]`）に `null` が返ること（クラッシュしない）。
- `notes` にタグが存在しない場合に `null` が返ること。
- `strip_gentask_metadata` でタグ部分のみ除去されること。

**`lib/snapshot.test.ts` の変更:**
- `snapshot.save(uuid, taskId, listId, state)` のシグネチャ変更に合わせてテストを更新。
- `snapshot.restore(uuid)` が最新エントリを返すことを確認。
- UUID が異なるタスクのスナップショットが混在しないことを確認。

**`bin/sync.test.ts` の `undo` ケース変更:**
- `mock_restore` のシグネチャを `(uuid: string) => TaskSnapshot | null` に変更。
- `mock_tasks_get` が `notes` に有効なメタデータを返すモックを設定。

**`bin/slide.test.ts` の追加テスト:**
- `move_task` 実行後、戻り値タスクの `notes` に元の `uuid` が保持されていること。
- `move_task` 実行後、新しい `listId` がメタデータに反映されていること。
- `notes` の JSON が破損しているタスクの `move_task` がクラッシュしないこと。

---

## Phase 9: ゾンビタスク対応

**目標:** `sync` コマンドの `timeMin: 2週間前` ハードコードを廃止し、
管理下の全タスクが時間経過によって同期対象から外れない設計に変更する。

**完了条件:** `timeMin` の 2 週間制限が削除され、`gentask_uuid` フィルタのみで対象イベントを絞り込めること。全テストが通過すること。

---

### タスク 9-1: 問題の本質分析

**現在の実装（問題箇所）:**
```typescript
const two_weeks_ago = new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString();

const events_res = await cal_client.events.list({
    calendarId:              calendar_id,
    timeMin:                 two_weeks_ago, // ← ここが問題
    privateExtendedProperty: 'gentask_taskId',
    singleEvents:            true,
    orderBy:                 'startTime',
});
```

**問題:** `timeMin` を 2 週間前に設定しているため、2 週間以上前の予定に紐づく未完了タスクは
同期の対象外となり、システムから永遠に放置される「ゾンビタスク」が生まれる。

**解決方針:** `timeMin` を削除するか、十分に長い期間（例：1 年前）に設定する。
`gentask_uuid` フィルタ（`privateExtendedProperty`）で Gentask 管理イベントのみを絞り込む設計であれば、
`timeMin` は必須ではない。

ただし Google Calendar API の `events.list` は `timeMin` なしだと非常に古いイベントまで返す可能性があり、
パフォーマンスと実用性のバランスから **「未完了タスクが存在するかぎり同期する」** ロジックを実装する。

---

### タスク 9-2: `bin/sync.ts` — `timeMin` を動的計算に変更

**実装方針:**
1. `timeMin` を `1 年前` に拡張する（ゾンビタスク問題の即時解決）。
2. 加えて、`currentStatus: 100`（完了済み）のイベントは同期対象から除外し、AI の呼び出しコストを削減する。

**変更後の実装:**

```typescript
// Before（ハードコード）
const two_weeks_ago = new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString();

// After（1年前に拡張 + 環境変数でカスタマイズ可能）
const SYNC_WINDOW_DAYS = parseInt(process.env.GENTASK_SYNC_WINDOW_DAYS ?? '365', 10);
const time_min = new Date(Date.now() - SYNC_WINDOW_DAYS * 24 * 60 * 60_000).toISOString();

const events_res = await cal_client.events.list({
    calendarId:              calendar_id,
    timeMin:                 time_min, // デフォルト 1 年前
    privateExtendedProperty: 'gentask_uuid', // ← Phase 8 で uuid に変更したフィールド名
    singleEvents:            true,
    orderBy:                 'startTime',
    maxResults:              250, // 安全のため上限を設定
});
```

---

### タスク 9-3: `bin/sync.ts` — 完了済みタスクのフィルタリング最適化

**変更箇所:** `sync_inputs` を構築するループに、完了済みタスクをスキップするロジックを追加する。

```typescript
for (const event of events) {
    const priv      = event.extendedProperties?.private ?? {};
    const task_id   = priv['gentask_taskId'];
    const list_id   = priv['gentask_listId'];
    const task_uuid = priv['gentask_uuid']; // ← Phase 8 で追加

    if (!task_id || !list_id) continue;

    let task_res;
    try {
        task_res = await tasks_client.tasks.get({ tasklist: list_id, task: task_id });
    } catch (err) {
        // タスクが削除済みの場合など（孤立イベント）はスキップ
        console.warn(`  [Sync] タスク取得失敗 (taskId: ${task_id}):`, err);
        continue;
    }

    const current_status = task_res.data.status === 'completed' ? 100 : 0;

    // 完了済みタスクは AI 解析コスト削減のためスキップ
    // （ユーザーが「undo」コマンドを入力した場合のみ再エントリ）
    if (current_status === 100 && !(event.description ?? '').toLowerCase().includes('undo')) {
        continue;
    }

    list_map.set(task_id, list_id);
    sync_inputs.push({
        eventId:       event.id!,
        taskId:        task_id,
        listId:        list_id,
        subject:       event.summary ?? '',
        bodyContent:   event.description ?? '',
        currentStatus: current_status,
    });
}
```

---

### タスク 9-4: `lib/env.ts` — `GENTASK_SYNC_WINDOW_DAYS` をオプション変数として文書化

`lib/env.ts` の `REQUIRED_VARS` に追加する必要はないが、
`README` または `docs/03_system_architecture.md` のオプション環境変数テーブルに追記する。

```markdown
| `GENTASK_SYNC_WINDOW_DAYS` | `365` | sync コマンドが遡る日数（デフォルト 1 年） |
```

---

### タスク 9-5: テストの更新

**`bin/sync.test.ts` の追加テスト:**
- `timeMin` が現在日時から `GENTASK_SYNC_WINDOW_DAYS` 日前の値になっていることを確認。
- 完了済みタスク（`currentStatus: 100`）が本文に `undo` を含まない場合は `sync_inputs` に含まれないことを確認。
- タスク取得で `404` エラーが返った場合にループがクラッシュせず続行することを確認。

---

## Phase 10: GCP 完全無人化

**目標:** `npm run slide:prod`（手動）および `npm run sync:prod`（手動）を廃止し、
**Cloud Run Jobs + Cloud Scheduler** によって完全自動実行される設計に移行する。
クリエイターは CLI を一切触れることなく、システムが自律稼働する。

**前提:** Phase 7〜9 が完成し、ローカル CLI が完全動作していること。GCP プロジェクトが存在すること。

**完了条件:**
- `npm run slide:prod` を手動で実行せずとも、毎週日曜 21:00 JST にスライドが自動実行されること。
- Google Calendar を更新後、15 分以内に Google Tasks が自動更新されること（または Webhook による即時更新）。

---

### タスク 10-1: GCP プロジェクト・IAM 設定

**手順（一度だけ実施）:**

```bash
# 1. GCP プロジェクト作成（既存があればスキップ）
gcloud projects create gentask-prod --name="Gentask"
gcloud config set project gentask-prod

# 2. 必要 API の有効化
gcloud services enable \
    run.googleapis.com \
    cloudscheduler.googleapis.com \
    tasks.googleapis.com \
    calendar-json.googleapis.com \
    aiplatform.googleapis.com

# 3. サービスアカウント作成
gcloud iam service-accounts create gentask-sa \
    --display-name="Gentask Service Account"

# 4. 必要なロールを付与
gcloud projects add-iam-policy-binding gentask-prod \
    --member="serviceAccount:gentask-sa@gentask-prod.iam.gserviceaccount.com" \
    --role="roles/run.invoker"
```

**Google Workspace 管理コンソールでの設定（Domain-wide Delegation）:**
1. GCP コンソール → IAM & Admin → サービスアカウント → `gentask-sa` → 「キーを管理」 → JSON キー生成
2. Google Workspace 管理コンソール → セキュリティ → API 制御 → Domain-wide Delegation
3. クライアント ID に `gentask-sa` の OAuth クライアント ID を追加
4. スコープに以下を追加:
   - `https://www.googleapis.com/auth/tasks`
   - `https://www.googleapis.com/auth/calendar.events`

---

### タスク 10-2: `src/google.ts` — サービスアカウント認証モードを追加

**変更方針:** 環境変数 `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` が存在する場合は
サービスアカウント JWT 認証を使い、存在しない場合はローカル OAuth トークンを使う。
この分岐により、ローカル開発（dev）と GCP 本番（prod）で同じコードが動作する。

```typescript
import { google, Auth } from 'googleapis';

/**
 * @function createAuthClient
 * @description 実行環境に応じて適切な認証クライアントを返す。
 * - GOOGLE_SERVICE_ACCOUNT_KEY_PATH が設定されている場合: サービスアカウント JWT 認証
 * - それ以外: ローカル OAuth2 クライアント（従来の createOAuthClient()）
 */
export function createAuthClient(): Auth.OAuth2Client | Auth.GoogleAuth {
    const sa_key_path = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;

    if (sa_key_path) {
        // GCP 本番環境: サービスアカウント認証
        return new google.auth.GoogleAuth({
            keyFile: sa_key_path,
            scopes: [
                'https://www.googleapis.com/auth/tasks',
                'https://www.googleapis.com/auth/calendar.events',
            ],
        });
    }

    // ローカル開発環境: OAuth2 クライアント（既存の createOAuthClient）
    return createOAuthClient();
}
```

**`bin/index.ts`, `bin/sync.ts`, `bin/slide.ts` での変更:**
各ファイルの `createOAuthClient()` 呼び出しを `createAuthClient()` に変更する。

---

### タスク 10-3: `Dockerfile` の作成

```dockerfile
# gentask/Dockerfile
FROM node:20-slim

WORKDIR /app

# 依存関係インストール（production のみ）
COPY package*.json ./
RUN npm ci --omit=dev

# ソースコードのコピー
COPY tsconfig.json ./
COPY lib/ ./lib/
COPY src/ ./src/
COPY bin/ ./bin/

# デフォルトコマンド（Cloud Run Job で上書きされる）
CMD ["node", "--loader", "tsx/esm", "bin/sync.ts", "prod"]
```

**`.dockerignore` の作成:**
```
node_modules/
.env*
.google_token*
~/.gentask/
docs/
*.test.ts
vitest.config.ts
```

---

### タスク 10-4: `package.json` — Docker ビルド・プッシュスクリプトの追加

```json
{
  "scripts": {
    "docker:build": "docker build -t gcr.io/gentask-prod/gentask:latest .",
    "docker:push":  "docker push gcr.io/gentask-prod/gentask:latest",
    "docker:deploy": "npm run docker:build && npm run docker:push"
  }
}
```

---

### タスク 10-5: Cloud Run Jobs の設定（slide・sync）

**`slide` ジョブの作成:**
```bash
gcloud run jobs create gentask-slide \
    --image=gcr.io/gentask-prod/gentask:latest \
    --command="node" \
    --args="--loader,tsx/esm,bin/slide.ts,prod" \
    --region=asia-northeast1 \
    --service-account=gentask-sa@gentask-prod.iam.gserviceaccount.com \
    --set-env-vars=GCP_VERTEX_AI_API_KEY=${GCP_VERTEX_AI_API_KEY},GOOGLE_CALENDAR_ID=${GOOGLE_CALENDAR_ID},GOOGLE_SERVICE_ACCOUNT_KEY_PATH=/secrets/sa_key.json \
    --set-secrets=/secrets/sa_key.json=gentask-sa-key:latest
```

**`sync` ジョブの作成:**
```bash
gcloud run jobs create gentask-sync \
    --image=gcr.io/gentask-prod/gentask:latest \
    --command="node" \
    --args="--loader,tsx/esm,bin/sync.ts,prod" \
    --region=asia-northeast1 \
    --service-account=gentask-sa@gentask-prod.iam.gserviceaccount.com \
    --set-env-vars=GCP_VERTEX_AI_API_KEY=${GCP_VERTEX_AI_API_KEY},GOOGLE_CALENDAR_ID=${GOOGLE_CALENDAR_ID},GOOGLE_SERVICE_ACCOUNT_KEY_PATH=/secrets/sa_key.json \
    --set-secrets=/secrets/sa_key.json=gentask-sa-key:latest
```

---

### タスク 10-6: Cloud Scheduler の設定（完全自動化）

**週次スライド（日曜 21:00 JST）:**
```bash
gcloud scheduler jobs create http gentask-slide-weekly \
    --schedule="0 21 * * 0" \
    --time-zone="Asia/Tokyo" \
    --uri="https://asia-northeast1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/gentask-prod/jobs/gentask-slide:run" \
    --message-body='{}' \
    --oauth-service-account-email=gentask-sa@gentask-prod.iam.gserviceaccount.com \
    --location=asia-northeast1
```

**定期同期（15 分おき）:**
```bash
gcloud scheduler jobs create http gentask-sync-periodic \
    --schedule="*/15 * * * *" \
    --time-zone="Asia/Tokyo" \
    --uri="https://asia-northeast1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/gentask-prod/jobs/gentask-sync:run" \
    --message-body='{}' \
    --oauth-service-account-email=gentask-sa@gentask-prod.iam.gserviceaccount.com \
    --location=asia-northeast1
```

---

### タスク 10-7: GitHub Actions CI/CD パイプラインの作成

**`.github/workflows/deploy.yml` の作成:**

```yaml
name: Deploy to GCP Cloud Run

on:
  push:
    branches: [main]
  workflow_dispatch:  # 手動実行も可能

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write  # Workload Identity Federation のため

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: TZ=Asia/Tokyo npm test

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: gentask-sa@gentask-prod.iam.gserviceaccount.com

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker
        run: gcloud auth configure-docker

      - name: Build and push Docker image
        run: |
          docker build -t gcr.io/gentask-prod/gentask:${{ github.sha }} .
          docker push gcr.io/gentask-prod/gentask:${{ github.sha }}
          docker tag gcr.io/gentask-prod/gentask:${{ github.sha }} gcr.io/gentask-prod/gentask:latest
          docker push gcr.io/gentask-prod/gentask:latest

      - name: Update Cloud Run Jobs
        run: |
          gcloud run jobs update gentask-slide \
            --image=gcr.io/gentask-prod/gentask:${{ github.sha }} \
            --region=asia-northeast1
          gcloud run jobs update gentask-sync \
            --image=gcr.io/gentask-prod/gentask:${{ github.sha }} \
            --region=asia-northeast1
```

---

### タスク 10-8: `docs/setup_3.md` — GCP デプロイ手順書の作成

以下のセクションを含む運用手順書を `docs/setup_3.md` として作成する。

1. **前提条件**（GCP アカウント、gcloud CLI、Docker）
2. **初回セットアップ手順**（タスク 10-1〜10-6 の手順を対話形式で記載）
3. **シークレット管理**（GCP Secret Manager への SA キー格納方法）
4. **デプロイフロー**（GitHub main ブランチへのプッシュで自動デプロイ）
5. **トラブルシューティング**（よくあるエラーと対処法）
6. **コスト管理**（無料枠の確認方法・使用量モニタリング設定）

---

## テスト追加サマリー

全フェーズ完了時に追加されるテスト数の概算：

| フェーズ | テストファイル | 追加テスト数（概算） |
|:---|:---|:---|
| Phase 7 | `lib/types.test.ts`, `bin/slide.test.ts` | +12 |
| Phase 8 | `lib/types.test.ts`, `lib/snapshot.test.ts`, `bin/sync.test.ts`, `bin/slide.test.ts` | +20 |
| Phase 9 | `bin/sync.test.ts` | +4 |
| Phase 10 | （インフラのため自動テスト対象外。E2E 検証は手動） | - |
| **合計** | | **+36** |

**Phase 7〜9 完了後の総テスト数:** 約 100 件（Phase 0〜6 の約 64 件 + 追加 36 件）

---

## フェーズ間の依存関係

```
Phase 7（sub_role enum化）
    │
    ▼
Phase 8（UUID永続ID導入）  ← Phase 7 の sub_role を UUID メタデータに埋め込むため依存
    │
    ▼
Phase 9（ゾンビタスク対応） ← Phase 8 の gentask_uuid フィールド名変更に依存
    │
    ▼
Phase 10（GCP無人化） ← Phase 7〜9 のローカル CLI 完成が前提
```

各フェーズは前のフェーズが完了（全テスト通過）していることを確認してから着手すること。

---

## 検証基準（Success Criteria）

### Phase 7 完了後
1. `npm run gen:dev -- "第50話"` を実行し、生成タスクの `sub_role` が `plot` / `name` / `post` / `other` のいずれかであること。
2. `npm run slide:dev` 実行で `PLANNING_SCHEDULE` の分岐が `sub_role` で行われ、`plot` タスクが水・木曜に配置されること。
3. コードベース全体で `title.includes('プロット')` `title.includes('ネーム')` `title.includes('投稿')` が 0 件であること。

### Phase 8 完了後
4. `npm run gen:dev -- "テスト"` 実行後、生成タスクの `notes` 末尾に `[gentask:{...,"uuid":"<v4>"}]` が含まれること。
5. `npm run slide:dev` 実行で今週分 → 完了 への `move_task` 後、移動後タスクの `notes` に同じ `uuid` が保持されていること。
6. Google Calendar の `extendedProperties.private.gentask_uuid` が移動後も同じ値であること。
7. `notes` の末尾 JSON を手動で壊したタスクに対して `npm run sync:dev` を実行してもクラッシュしないこと。

### Phase 9 完了後
8. 作成から 3 週間以上経過した未完了タスクが、`npm run sync:dev` の同期対象に含まれること。

### Phase 10 完了後
9. `main` ブランチへのプッシュで GitHub Actions が自動起動し、テスト通過後に Cloud Run Jobs が更新されること。
10. 日曜 21:00 JST に手動操作なしでスライドが完了し、Google Tasks と Google Calendar が更新されていること。
11. Google Calendar イベントの本文に「ok」と書いてから 15 分以内に Google Tasks のタスクが `completed` になること。
