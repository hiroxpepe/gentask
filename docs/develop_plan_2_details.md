# Gentask Google化改修計画 — 実コード検証済み版

> **目的:** Microsoft 365（Planner / Outlook / Microsoft Graph）を完全撤去し、Google Tasks + Google Calendar のみを使用するシステムへ全面改修する。
>
> **本文書の根拠:** `lib/types.ts` `lib/env.ts` `lib/snapshot.ts` `src/google.ts` `bin/index.ts` `bin/sync.ts` `bin/slide.ts` `bin/index.test.ts` `bin/sync.test.ts` `bin/slide.test.ts` `package.json` の全ソースコードを読んだうえで記述している。根拠のない行番号・件数は記載しない。

---

## ⚠️ 改修前に確認すべき設計上の問題点

コードを読んで発見した問題を先に示す。手順書を実行する前に把握すること。

### 問題1: `snapshot.ts` のキー設計が Google 化後と噛み合わない

現在の `snapshot.restore()` は `Map<string, TaskSnapshot>` を返し、キーは `url`（Graph API エンドポイント文字列）である。`TaskSnapshot` インターフェース自体に `url` フィールドが含まれており、undo 処理は「URLごとに PATCH を発行する」設計になっている。

Google Tasks API に切り替えた場合、PATCH の概念がなく `tasks.tasks.update` を使う。URL キーは意味をなさなくなる。**`lib/snapshot.ts` の `url` フィールドと `restore()` の戻り値の使い方を Google 向けに変更する必要があり、これは手順書に記載のない追加作業である。**

設計方針（手順書実施者が決定すること）:
- `url` フィールドを `listId` に用途変換し、`restore()` のキーを `listId` にする
- または `snapshot.ts` 自体を Google 向けに書き直す

### 問題2: `bin/sync.test.ts` のファイル名が実際は `bin/index.test.ts` の内容

貼られたファイルを確認すると、`bin/index.test.ts` として渡されたファイルの内容は `PlannerSyncService` のテスト（`PlannerSyncService.apply_actions` の describe ブロック）であり、`task_flow` のテストではない。**`bin/index.test.ts` として渡されたものが sync のテストで、`bin/sync.test.ts` として渡されたものが index のテストである。** 改修時にファイル名と内容の対応を正確に確認すること。

### 問題3: `src/google.ts` の `createOAuthClient()` はトークンファイルが存在しない場合に無音で続行する

```typescript
try {
    if (fs.existsSync(TOKEN_PATH)) {
        const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        oAuth2Client.setCredentials(token);
    }
} catch (e) {
    // ignore
}
```

トークンがない状態でも例外を出さず返す。実行時に API 呼び出しで初めて認証エラーになる。テストのモックでは隠蔽されるため、フェーズ6（E2E）まで気づきにくい。

### 問題4: `bin/slide.test.ts` は M365 依存のまま

現行の `bin/slide.test.ts` は `PlannerTask` 型・`get_latest_plan`・`get_buckets` などの M365 固有関数をテストしている。これらは Google 化後に削除される関数のテストであり、フェーズ5で全面書き直しが必要である（手順書の記述と一致している）。

### 問題5: `task_schema` に M365 固有フィールドが残っている

`label: z.enum(['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Pink'])` は Microsoft Planner のラベル色仕様である。Google Tasks にはラベル色の概念がない。手順書には `task_schema` の変更が記載されていないが、このフィールドの扱いを決める必要がある（削除 or 残留してメモ用途に転用）。

---

## 改修の全体方針

### 現状（実コード確認済み）

- `src/planner.ts`、`lib/graph.ts`、`lib/outlook.ts` は削除済み（`import` は残っておりコンパイルエラーの原因）。
- `bin/index.ts` は `PlannerService` を import しているがファイルが存在しない。
- `bin/sync.ts` は `OutlookService`・`graph` を import しているがファイルが存在しない。
- `bin/slide.ts` は `graph`・`OutlookService` を import しているがファイルが存在しない。
- `lib/types.ts` に `outlook_event` 型、`plannerTaskId` フィールド、M365 固有の `sync_input_item` 型が残っている。
- `lib/env.ts` の `REQUIRED_VARS` が M365 仕様（`M365_USER_ID` ら5変数）のまま。
- `src/google.ts` はすでに実装済みで、`createOAuthClient()`・`generateAuthUrl()`・`exchangeCodeAndSave()`・`createCalendarEvent()`・`createTask()` が存在する。
- `lib/snapshot.ts` は Graph API の URL をキーとした設計のままであり、Google 化後の undo 処理と整合しない。

### 完了後の姿

- バックエンドが Google Tasks + Google Calendar に統一される。
- 12 個の Google Tasks リスト（`gentask_{MODE}_{バケット名}`）でタスクを管理。
- Google Calendar と Google Tasks が双方向リンクで結ばれ、`sync` コマンドで自動同期される。
- 全テストが Google API モックで通過する。

---

## フェーズ 0: 型定義・環境変数の整備

**目標:** 全モジュールが依存する基盤型を Google 仕様に更新し、コンパイルエラーの起点を解消する。

**完了条件:** `TZ=Asia/Tokyo npm test` で `lib/types.test.ts` と `lib/env.test.ts` がすべて通過すること。

---

### タスク 0-1: `lib/types.ts` の更新

**削除する箇所（実コード確認済み）:**

`outlook_event` 型を削除する。現在のコードは以下のブロックである。

```typescript
// 削除対象
export type outlook_event = {
    id: string;
    subject: string;
    body: { contentType: string; content: string };
    start: { dateTime: string; timeZone: string };
    end:   { dateTime: string; timeZone: string };
    extensions?: Array<{ id: string; plannerTaskId?: string }>;
};
```

**変更する箇所1 — `sync_action_schema` の `plannerTaskId` フィールド:**

変更前（実コード）:
```typescript
plannerTaskId: z.string()
    .describe('操作対象の Planner タスク ID'),
```

変更後:
```typescript
taskId: z.string()
    .describe('操作対象の Google Tasks タスク ID'),
```

**変更する箇所2 — `sync_input_item` 型:**

変更前（実コード）:
```typescript
export type sync_input_item = {
    outlookEventId: string;
    plannerTaskId: string;
    subject: string;
    bodyContent: string;
    currentStatus: number; // Planner percentComplete (0 / 50 / 100)
};
```

変更後:
```typescript
export type sync_input_item = {
    eventId:       string;   // Google Calendar イベント ID
    taskId:        string;   // Google Tasks タスク ID
    listId:        string;   // Google Tasks リスト ID（新規追加）
    subject:       string;
    bodyContent:   string;
    currentStatus: number;   // 0=未完了, 100=完了（Google Tasks は二値）
};
```

**判断が必要な箇所 — `task_schema` の `label` フィールド:**

`label: z.enum(['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Pink'])` は Planner 固有仕様。Google Tasks に対応する概念がない。以下のいずれかを選択すること。

- 削除する（`bin/index.test.ts` の schema 比較テストに影響する）
- `optional()` にしてメモ用途として残す

本手順書では削除しない方針を前提とする（`bin/index.test.ts` の変更を最小化するため）。

---

### タスク 0-2: `lib/env.ts` の更新

`REQUIRED_VARS` 配列を以下に置き換える。

変更前（実コード）:
```typescript
const REQUIRED_VARS = [
    'M365_USER_ID',
    'M365_PLANNER_PTASK_GROUP_ID',
    'M365_PLANNER_TTASK_GROUP_ID',
    'M365_PLANNER_CTASK_GROUP_ID',
    'M365_PLANNER_ATASK_GROUP_ID',
    'GCP_VERTEX_AI_API_KEY',
] as const;
```

変更後:
```typescript
const REQUIRED_VARS = [
    'GCP_VERTEX_AI_API_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_CALENDAR_ID',
] as const;
```

**注意:** `src/google.ts` は `GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`・`GOOGLE_REDIRECT_URI`・`GOOGLE_TOKEN_PATH` を参照している。`GOOGLE_REDIRECT_URI` と `GOOGLE_TOKEN_PATH` はデフォルト値があるため必須ではない。`GOOGLE_CALENDAR_ID` は `src/google.ts` に直接参照箇所はないが、`bin/index.ts`・`bin/sync.ts` のデプロイ処理で必要になる。

---

### タスク 0-3: `lib/types.test.ts` の更新

`sync_action_schema` のテストで `plannerTaskId` を使用している箇所をすべて `taskId` に置き換える。実際のテストファイルを開いて変更箇所を特定してから実施すること（本文書ではファイルの内容を確認していない）。

---

### タスク 0-4: `lib/env.test.ts` の更新

テスト内の `REQUIRED` 配列を以下に更新する。

```typescript
const REQUIRED = [
    'GCP_VERTEX_AI_API_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_CALENDAR_ID',
];
```

欠損チェックのテストで削除した変数（`M365_USER_ID` など）を、新しい変数名（`GOOGLE_CLIENT_ID` など）に差し替える。

---

## フェーズ 1: Google コアモジュールの整備

**目標:** Google Tasks リストのライフサイクルを管理する `src/google-container-manager.ts` を新規作成する。

**完了条件:** `tsc --noEmit` でこのファイルが TypeScript エラーなくコンパイルできること。

---

### タスク 1-1: `src/google-container-manager.ts` を新規作成する

`src/google.ts` に `createOAuthClient()` が実装済みであることを確認済み。戻り値は `google.auth.OAuth2` インスタンスであり、`auth` 引数の型として使用できる。

```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';
import { google } from 'googleapis';
import type { bucket_role } from '../lib/types';

const CACHE_FILE = path.join(os.homedir(), '.gentask', 'tasklists.json');

const BUCKET_LABELS: Record<bucket_role, string> = {
    current: '今週分',
    next:    '来週分',
    done:    '完了',
};

export class GoogleContainerManager {
    private cache: Record<string, Record<bucket_role, string>> = {};

    constructor() {
        try {
            if (fs.existsSync(CACHE_FILE)) {
                this.cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            }
        } catch {
            this.cache = {};
        }
    }

    async get_container(mode: string, auth: any): Promise<Record<bucket_role, string>> {
        // 1. キャッシュヒット
        if (this.cache[mode]) return this.cache[mode];

        const tasks_client = google.tasks({ version: 'v1', auth });

        // 2. 既存リストを全件取得
        const list_res = await tasks_client.tasklists.list({ maxResults: 100 });
        const existing = list_res.data.items ?? [];

        const result: Partial<Record<bucket_role, string>> = {};

        for (const role of ['current', 'next', 'done'] as bucket_role[]) {
            const expected_name = `gentask_${mode}_${BUCKET_LABELS[role]}`;
            const found = existing.find(l => l.title === expected_name);

            if (found?.id) {
                result[role] = found.id;
            } else {
                // 3. 存在しなければ新規作成
                const created = await tasks_client.tasklists.insert({
                    requestBody: { title: expected_name },
                });
                result[role] = created.data.id!;
            }
        }

        const container = result as Record<bucket_role, string>;

        // 4. キャッシュ保存
        this.cache[mode] = container;
        fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2));

        return container;
    }
}
```

---

## フェーズ 2: `bin/index.ts` の Google 化

**目標:** タスク生成・デプロイを Google Tasks + Google Calendar に切り替える。

**完了条件:** `npm run gen:dev -- "テスト"` がエラーなく実行でき、Google Tasks と Google Calendar にアイテムが作成されること。

---

### タスク 2-1: 不要インポートの削除

変更前（実コード）:
```typescript
import { PlannerService } from '../src/planner';
```

この1行を削除する。`task_schema`・`gen_task`・`validate_env` のインポートはそのまま残す。

---

### タスク 2-2: 追加インポートの記述

削除した行の代わりに以下を追加する。

```typescript
import { google } from 'googleapis';
import { createOAuthClient } from '../src/google';
import { GoogleContainerManager } from '../src/google-container-manager';
```

---

### タスク 2-3: デプロイ処理の書き換え

エントリポイント `(async () => {...})()` 内の以下の部分を置き換える。

変更前（実コード）:
```typescript
// 2. Planner サービスを使用して M365 へ展開
const service_instance = new PlannerService();
await service_instance.execute_deployment(generated_tasks);
console.log(`\n✨ Successfully deployed ${generated_tasks.length} tasks.`);
```

変更後:
```typescript
// 2. Google Tasks + Calendar へ展開
const auth      = createOAuthClient();
const manager   = new GoogleContainerManager();
const tasks_client    = google.tasks({ version: 'v1', auth });
const cal_client      = google.calendar({ version: 'v3', auth });
const calendar_id     = process.env.GOOGLE_CALENDAR_ID!;

for (const task of generated_tasks) {
    const bucket: 'current' | 'next' =
        (task.bucket as 'current' | 'next' | undefined) ??
        (task.mode === 'PTASK' ? 'next' : 'current');

    const container = await manager.get_container(task.mode, auth);
    const list_id   = container[bucket];

    // Google Tasks にタスク作成
    const task_res = await tasks_client.tasks.insert({
        tasklist: list_id,
        requestBody: {
            title: task.title,
            notes: task.description,
        },
    });
    const task_id = task_res.data.id!;

    // Google Calendar にイベント作成（30分後開始・60分後終了）
    const start_dt = new Date(Date.now() + 30 * 60_000);
    const end_dt   = new Date(Date.now() + 60 * 60_000);

    const event_res = await cal_client.events.insert({
        calendarId: calendar_id,
        requestBody: {
            summary:     `[${task.mode}] ${task.title}`,
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

    // タスクの notes に双方向リンクを追記
    await tasks_client.tasks.update({
        tasklist: list_id,
        task:     task_id,
        requestBody: {
            id:    task_id,
            title: task.title,
            notes: `${task.description}\n[gentask:{"eventId":"${event_id}","calendarId":"${calendar_id}","listId":"${list_id}"}]`,
        },
    });

    console.log(`  ✅ ${task.mode} | ${task.title}`);
}

console.log(`\n✨ Successfully deployed ${generated_tasks.length} tasks.`);
```

**保持するもの（`bin/index.test.ts` が依存しているため変更禁止）:**

- `export { task_schema, type gen_task }` の export 文
- `export const task_flow` の export とそのシグネチャ（`inputSchema: z.string()`、`outputSchema: z.array(task_schema)`）
- `task_flow` 内部のプロンプト文字列（`bin/index.test.ts` が文字列比較している）

---

## フェーズ 3: `bin/sync.ts` の Google 化

**目標:** `PlannerSyncService` を `GoogleSyncService` に置き換え、カレンダー読取と Tasks 更新をすべて Google API に切り替える。

**完了条件:** `npm run sync:dev` がエラーなく実行でき、「No linked events found.」または正常な同期結果が表示されること。

---

### タスク 3-1: インポートの更新

削除するインポート（実コード確認済み）:
```typescript
import { OutlookService } from '../lib/outlook';
import { graph } from '../lib/graph';
```

追加するインポート:
```typescript
import { google } from 'googleapis';
import { createOAuthClient } from '../src/google';
```

`snapshot` のインポートは残す（undo 処理で使用）:
```typescript
import { snapshot } from '../lib/snapshot';
```

---

### タスク 3-2: `sync_flow` の inputSchema 更新

変更前（実コード）:
```typescript
inputSchema: z.array(z.object({
    outlookEventId: z.string(),
    plannerTaskId:  z.string(),
    subject:        z.string(),
    bodyContent:    z.string(),
    currentStatus:  z.number(),
})),
```

変更後:
```typescript
inputSchema: z.array(z.object({
    eventId:       z.string(),
    taskId:        z.string(),
    listId:        z.string(),
    subject:       z.string(),
    bodyContent:   z.string(),
    currentStatus: z.number(),
})),
```

プロンプト内の `item.plannerTaskId` を `item.taskId` に変更する（実コードでは `items_text` の map 処理内）。

---

### タスク 3-3: `PlannerSyncService` を `GoogleSyncService` に書き換える

**重要:** 現行の `bin/sync.test.ts`（実際には index.test.ts として渡されたファイル）は `PlannerSyncService` を import してテストしている。フェーズ5でテストも書き換えるため、このフェーズでは `PlannerSyncService` クラス名を `GoogleSyncService` に変更してよい。

**`snapshot.restore()` の戻り値の扱いについて（⚠️ 設計問題1 の影響）:**

現行の `restore()` は `Map<string, TaskSnapshot>` を返し、キーは Graph API の URL 文字列である。Google 化後は URL でなく `listId` をキーとして使う必要がある。`snapshot.ts` の `url` フィールドを `listId` として読み替える移行期対応を行うか、`snapshot.ts` を書き直すかを決定すること。

新しいクラスの実装:

```typescript
export class GoogleSyncService {
    async apply_actions(
        actions: sync_action[],
        list_map: Map<string, string>  // taskId → listId
    ): Promise<void> {
        const auth         = createOAuthClient();
        const tasks_client = google.tasks({ version: 'v1', auth });

        for (const action of actions) {
            if (action.action === 'no_change') continue;

            // taskId フィールド名が変わっている（タスク0-1で plannerTaskId → taskId）
            const task_id = action.taskId;
            const list_id = list_map.get(task_id);

            if (!list_id) {
                console.warn(`  [Sync] listId not found for taskId: ${task_id}. Skipping.`);
                continue;
            }

            console.log(`  [Sync] ${action.action} → Task: ${task_id}`);

            switch (action.action) {
                case 'complete': {
                    await tasks_client.tasks.update({
                        tasklist: list_id,
                        task:     task_id,
                        requestBody: { id: task_id, status: 'completed' },
                    });
                    break;
                }

                case 'reschedule': {
                    if (!action.newDueDate) break;
                    await tasks_client.tasks.update({
                        tasklist: list_id,
                        task:     task_id,
                        requestBody: { id: task_id, due: action.newDueDate },
                    });
                    break;
                }

                case 'add_note':
                case 'buffer_consumed': {
                    if (!action.note) break;
                    const current = await tasks_client.tasks.get({
                        tasklist: list_id,
                        task:     task_id,
                    });
                    const prev    = current.data.notes ?? '';
                    const updated = prev
                        ? `${prev}\n\n---\n${new Date().toISOString()}: ${action.note}`
                        : `${new Date().toISOString()}: ${action.note}`;
                    await tasks_client.tasks.update({
                        tasklist: list_id,
                        task:     task_id,
                        requestBody: { id: task_id, notes: updated },
                    });
                    break;
                }

                case 'undo': {
                    // ⚠️ snapshot.ts の url フィールドを listId として読み替えている
                    const snap_map = snapshot.restore(task_id);
                    if (snap_map.size === 0) {
                        console.warn(`  [Undo] No snapshot found for task: ${task_id}`);
                        break;
                    }
                    for (const [, snap] of snap_map) {
                        await tasks_client.tasks.update({
                            tasklist: list_id,
                            task:     task_id,
                            requestBody: { id: task_id, ...snap.state },
                        });
                    }
                    break;
                }
            }
        }
    }
}
```

---

### タスク 3-4: `main()` 関数の書き換え

変更前（実コード）の `main()` は `OutlookService.get_linked_events()` と `graph.get()` に依存している。これを Google API に置き換える。

```typescript
export async function main(
    sync_svc = new GoogleSyncService()
) {
    try {
        const auth         = createOAuthClient();
        const cal_client   = google.calendar({ version: 'v3', auth });
        const tasks_client = google.tasks({ version: 'v1', auth });
        const calendar_id  = process.env.GOOGLE_CALENDAR_ID!;

        // 1. gentask リンク付きカレンダーイベントを2週間分取得
        console.log('🔍 Fetching linked Google Calendar events...');
        const two_weeks_ago = new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString();

        const events_res = await cal_client.events.list({
            calendarId:              calendar_id,
            timeMin:                 two_weeks_ago,
            privateExtendedProperty: 'gentask_taskId',
            singleEvents:            true,
            orderBy:                 'startTime',
        });

        const events = events_res.data.items ?? [];
        if (events.length === 0) {
            console.log('✅ No linked events found. Nothing to sync.');
            return;
        }
        console.log(`   Found ${events.length} event(s).`);

        // 2. 各イベントから taskId / listId を取得し、タスクのステータスを確認
        const sync_inputs: sync_input_item[] = [];
        const list_map = new Map<string, string>(); // taskId → listId

        for (const event of events) {
            const priv    = event.extendedProperties?.private ?? {};
            const task_id = priv['gentask_taskId'];
            const list_id = priv['gentask_listId'];

            if (!task_id || !list_id) continue;

            const task_res = await tasks_client.tasks.get({
                tasklist: list_id,
                task:     task_id,
            });

            const current_status = task_res.data.status === 'completed' ? 100 : 0;
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

        // 3. AI で変化を解釈
        console.log('🤖 Analyzing changes with AI...');
        const actions = await sync_flow(sync_inputs);
        const active  = actions.filter(a => a.action !== 'no_change');
        console.log(`   ${active.length} action(s) to apply.`);

        // 4. Google Tasks に反映
        await sync_svc.apply_actions(actions, list_map);

        console.log(`\n✨ Sync complete. ${active.length} task(s) updated.`);
    } catch (error) {
        console.error('Fatal sync error:', error);
    }
}
```

---

## フェーズ 4: `bin/slide.ts` の Google 化

**目標:** M365 依存をすべて削除し、Google Tasks + Google Calendar で週次スライドを実現する。

**完了条件:** `npm run slide:dev` がエラーなく実行でき、全モードのスライド処理が完了すること。

---

### タスク 4-1: 不要コードの削除

以下を削除する（すべて実コードで確認済み）:

```typescript
// 削除対象インポート
import { graph } from '../lib/graph';
import { OutlookService } from '../lib/outlook';

// 削除対象定数
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// 削除対象インターフェース
export interface PlannerTask { ... }
export interface PlannerBucket { ... }

// 削除対象関数
export async function get_latest_plan(...) { ... }
export async function get_buckets(...) { ... }
export async function get_tasks_in_bucket(...) { ... }
export async function move_task(...) { ... }  // 旧実装
```

エントリポイント内の以下も削除:
```typescript
const group_id = process.env[`M365_PLANNER_${mode}_GROUP_ID`];
if (!group_id) { ... }
const plan = await get_latest_plan(group_id);
if (!plan) { ... }
const buckets = await get_buckets(plan.id);
```

**残す定数・関数（`bin/slide.test.ts` でテストされているため）:**

- `PLANNING_SCHEDULE` 定数
- `get_schedule_key()` 関数
- `get_next_monday()` 関数（export 維持）
- `get_weekday_date()` 関数（export 維持）

---

### タスク 4-2: 追加インポートの記述

```typescript
import { google } from 'googleapis';
import { createOAuthClient } from '../src/google';
import { GoogleContainerManager } from '../src/google-container-manager';
```

---

### タスク 4-3: `GoogleTaskItem` インターフェースの追加

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

---

### タスク 4-4: ヘルパー関数の追加

**`get_tasks_in_list`（非 export）:**

```typescript
async function get_tasks_in_list(list_id: string, auth: any): Promise<GoogleTaskItem[]> {
    const tasks_client = google.tasks({ version: 'v1', auth });
    const res = await tasks_client.tasks.list({
        tasklist:      list_id,
        showCompleted: false,
    });
    return (res.data.items ?? []).map(t => ({
        id:     t.id!,
        title:  t.title ?? '',
        notes:  t.notes ?? undefined,
        status: (t.status as 'needsAction' | 'completed') ?? 'needsAction',
        due:    t.due ?? undefined,
        listId: list_id,
    }));
}
```

**`move_task`（非 export）:**

```typescript
async function move_task(
    task: GoogleTaskItem,
    source_list_id: string,
    target_list_id: string,
    auth: any,
    overrides?: Partial<Pick<GoogleTaskItem, 'due' | 'notes'>>
): Promise<GoogleTaskItem> {
    const tasks_client = google.tasks({ version: 'v1', auth });

    const inserted = await tasks_client.tasks.insert({
        tasklist: target_list_id,
        requestBody: {
            title:  task.title,
            notes:  overrides?.notes ?? task.notes,
            due:    overrides?.due   ?? task.due,
            status: task.status,
        },
    });

    await tasks_client.tasks.delete({
        tasklist: source_list_id,
        task:     task.id,
    });

    return {
        id:     inserted.data.id!,
        title:  inserted.data.title ?? task.title,
        notes:  inserted.data.notes ?? undefined,
        status: (inserted.data.status as 'needsAction' | 'completed') ?? 'needsAction',
        due:    inserted.data.due ?? undefined,
        listId: target_list_id,
    };
}
```

---

### タスク 4-5: `archive_current_week` の書き換え

**新しいシグネチャ（旧シグネチャは `plan_id: string, buckets: Map<string, string>` だった）:**

```typescript
export async function archive_current_week(
    container: Record<bucket_role, string>,
    auth: any,
    mode: string
): Promise<boolean> {
    const tasks = await get_tasks_in_list(container.current, auth);

    // CTASK のみ「投稿」タスクの完了を確認する
    if (mode === 'CTASK') {
        const post_task = tasks.find(t => t.title.includes('投稿'));
        if (!post_task) {
            console.warn('  [Archive] 投稿タスクが見つかりません。スライドをスキップします。');
            return false;
        }
        if (post_task.status !== 'completed') {
            console.warn(`  [Archive] 投稿タスク「${post_task.title}」が未完了。スライドをスキップします。`);
            return false;
        }
    }

    console.log(`  [Archive] 今週分 ${tasks.length} 件をアーカイブ中...`);
    for (const task of tasks) {
        await move_task(task, container.current, container.done, auth);
        console.log(`    → アーカイブ: ${task.title}`);
    }
    return true;
}
```

**旧実装との差分:**
- 引数が `plan_id + Map` から `container + auth + mode` に変わる。
- CTASK 以外（PTASK / TTASK / ATASK）は「投稿」チェックをしない。旧コードは全モードでチェックしていた。
- `percentComplete` による判定（旧: `< 100`）から `status !== 'completed'` に変わる（Google Tasks は二値）。
- `move_task` が insert + delete になるためタスク ID が変わる（旧は bucketId の PATCH のみ）。

---

### タスク 4-6: `promote_next_week` の書き換え

**新しいシグネチャ（旧: `plan_id + Map` → `PlannerTask[]` 返却）:**

```typescript
export async function promote_next_week(
    container: Record<bucket_role, string>,
    auth: any
): Promise<GoogleTaskItem[]> {
    const tasks = await get_tasks_in_list(container.next, auth);
    if (tasks.length === 0) {
        console.log('  [Promote] 来週分バケットにタスクがありません。');
        return [];
    }

    const next_monday = get_next_monday();
    const promoted: GoogleTaskItem[] = [];

    for (const task of tasks) {
        const new_task = await move_task(
            task,
            container.next,
            container.current,
            auth,
            { due: next_monday.toISOString() }
        );
        promoted.push(new_task);
        console.log(`  [Promote] 昇格: ${task.title}`);
    }
    return promoted;
}
```

**旧実装との差分:**
- 旧実装は etag 取得のために `graph.get()` を再度呼んでいたが、Google Tasks API は etag が不要なため削除。
- `startDateTime` の更新が `due` の設定に変わる。
- 戻り値の型が `PlannerTask[]` から `GoogleTaskItem[]` に変わる（**フェーズ4-7 のエントリポイントと連携**）。

---

### タスク 4-7: `schedule_promoted_tasks` の書き換え

**新しいシグネチャ（旧: `PlannerTask[]` を受け取り `OutlookService.create_event` を呼んでいた）:**

```typescript
export async function schedule_promoted_tasks(
    tasks: GoogleTaskItem[],
    auth: any
): Promise<void> {
    if (tasks.length === 0) return;

    const cal_client    = google.calendar({ version: 'v3', auth });
    const tasks_client  = google.tasks({ version: 'v1', auth });
    const calendar_id   = process.env.GOOGLE_CALENDAR_ID!;
    const next_mon      = get_next_monday();

    let default_slot = new Date(next_mon);
    default_slot.setHours(9, 0, 0, 0);

    for (const task of tasks) {
        const schedule_key = get_schedule_key(task.title);

        if (schedule_key) {
            for (const slot of PLANNING_SCHEDULE[schedule_key]) {
                const slot_start = get_weekday_date(next_mon, slot.day);
                slot_start.setHours(slot.hour, 0, 0, 0);
                const slot_end = new Date(slot_start.getTime() + slot.blocks * 30 * 60_000);

                const event_res = await cal_client.events.insert({
                    calendarId: calendar_id,
                    requestBody: {
                        summary:     task.title,
                        start:       { dateTime: slot_start.toISOString() },
                        end:         { dateTime: slot_end.toISOString() },
                        extendedProperties: {
                            private: {
                                gentask_taskId: task.id,
                                gentask_listId: task.listId,
                            },
                        },
                    },
                });

                // タスクの notes に双方向リンクを追記
                const event_id = event_res.data.id!;
                const prev_notes = task.notes ?? '';
                await tasks_client.tasks.update({
                    tasklist: task.listId,
                    task:     task.id,
                    requestBody: {
                        id:    task.id,
                        notes: `${prev_notes}\n[gentask:{"eventId":"${event_id}","calendarId":"${calendar_id}","listId":"${task.listId}"}]`,
                    },
                });

                console.log(`  [Schedule] ${task.title} → ${slot_start.toISOString()}`);
            }
        } else {
            const slot_end = new Date(default_slot.getTime() + 30 * 60_000);
            const event_res = await cal_client.events.insert({
                calendarId: calendar_id,
                requestBody: {
                    summary:     task.title,
                    start:       { dateTime: default_slot.toISOString() },
                    end:         { dateTime: slot_end.toISOString() },
                    extendedProperties: {
                        private: {
                            gentask_taskId: task.id,
                            gentask_listId: task.listId,
                        },
                    },
                },
            });

            const event_id = event_res.data.id!;
            const prev_notes = task.notes ?? '';
            await tasks_client.tasks.update({
                tasklist: task.listId,
                task:     task.id,
                requestBody: {
                    id:    task.id,
                    notes: `${prev_notes}\n[gentask:{"eventId":"${event_id}","calendarId":"${calendar_id}","listId":"${task.listId}"}]`,
                },
            });

            console.log(`  [Schedule] ${task.title} → ${default_slot.toISOString()}`);
            default_slot = slot_end;
        }
    }
}
```

---

### タスク 4-8: `generate_next_plot` の書き換え

**新しいシグネチャ（旧: `plan_id + Map + episode_hint`、旧実装は `M365_USER_ID` を参照していた）:**

```typescript
export async function generate_next_plot(
    container: Record<bucket_role, string>,
    episode_hint: string,
    auth: any
): Promise<void> {
    console.log(`  [Generate] 次々回プロット生成中... (${episode_hint})`);

    const { output } = await ai_engine.generate({
        prompt: `あなたは週刊漫画の連載管理AIです。「${episode_hint}」の次回エピソードのプロット作業を
4つの 0.5sp（30分）タスクに分解してください。
各タスクは PTASK（企画・言語化）として、具体的で実行可能なタイトルと詳細を持つこと。`,
        output: { schema: z.array(task_schema) },
    });

    if (!output || output.length === 0) {
        console.warn('  [Generate] AI がタスクを生成できませんでした。');
        return;
    }

    const tasks_client = google.tasks({ version: 'v1', auth });

    for (const task of output.slice(0, 4)) {
        await tasks_client.tasks.insert({
            tasklist: container.next,
            requestBody: {
                title: task.title,
                notes: task.description,
            },
        });
        console.log(`  [Generate] 生成: ${task.title}`);
    }
}
```

**旧実装との差分:**
- `M365_USER_ID` への参照が完全に消える。
- `graph.post()` が `tasks_client.tasks.insert()` に変わる。
- `planId`・`bucketId`・`assignments` の代わりに `tasklist`・`title`・`notes` のみ。

---

### タスク 4-9: エントリポイントの書き換え

```typescript
const is_main = process.argv[1] === fileURLToPath(import.meta.url);
if (is_main) {
(async () => {
    const episode_hint = process.argv.slice(3).join(' ') || '次エピソード';

    try {
        console.log('🗓️  Gentask Weekly Slide 開始...\n');

        const auth    = createOAuthClient();
        const manager = new GoogleContainerManager();

        for (const mode of MODES) {
            console.log(`\n📋 ${mode}`);
            const container = await manager.get_container(mode, auth);

            const archived = await archive_current_week(container, auth, mode);
            if (!archived) continue;

            const promoted = await promote_next_week(container, auth);

            if (promoted.length > 0) {
                console.log(`\n  📅 Google Calendar へ ${promoted.length} 件の予定を作成中...`);
                await schedule_promoted_tasks(promoted, auth);
            }

            if (mode === 'PTASK') {
                await generate_next_plot(container, episode_hint, auth);
            }
        }

        console.log('\n✨ Weekly Slide 完了。');
    } catch (error) {
        console.error('Fatal slide error:', error);
    }
})();
}
```

---

## フェーズ 5: テストの全面更新

**目標:** 削除・変更に伴いコンパイルエラーになっているテストを修正し、全テストがパスすること。

**完了条件:** `TZ=Asia/Tokyo npm test` で全テストがパスすること。

---

### タスク 5-1: `bin/sync.test.ts` の全面書き換え

**現行のテスト（実コード確認済み）は `PlannerSyncService` と `graph`・`snapshot` をモックしている。**

Google 化後の `GoogleSyncService` に対応するテストに全面書き換える。

**モック対象:**

```typescript
vi.mock('googleapis', () => ({
    google: {
        auth: { OAuth2: class { setCredentials() {} } },
        tasks: vi.fn(() => ({
            tasks: {
                get:    mock_tasks_get,
                update: mock_tasks_update,
            },
        })),
    },
}));
vi.mock('../src/google', () => ({ createOAuthClient: vi.fn(() => ({})) }));
vi.mock('../lib/snapshot', () => ({ snapshot: { restore: mock_restore } }));
```

**必要なテストケース（8件）:**

| テスト | 検証内容 |
| :--- | :--- |
| `no_change` はスキップされ `update` が呼ばれない | `mock_tasks_update` が呼ばれないこと |
| `list_map` に存在しない `taskId` はスキップ | `mock_tasks_update` が呼ばれないこと |
| `complete` は `status: 'completed'` で update | `requestBody.status === 'completed'` |
| `reschedule` は `newDueDate` で update | `requestBody.due === newDueDate` |
| `reschedule` で `newDueDate` がない場合は update しない | `mock_tasks_update` が呼ばれないこと |
| `add_note` は既存 notes に追記して update | `requestBody.notes` に新旧両方のテキストが含まれること |
| `buffer_consumed` も notes に追記して update | 同上 |
| `undo` はスナップショットから状態を復元して update | `mock_restore` が呼ばれ、`mock_tasks_update` が呼ばれること |

**注意:** `action.plannerTaskId` を参照していた箇所はすべて `action.taskId` に変わっている（タスク 0-1 の変更による）。

---

### タスク 5-2: `bin/slide.test.ts` の全面書き換え

**現行のテスト（実コード確認済み）は `graph`・`OutlookService`・`get_latest_plan`・`PlannerTask` 型などの M365 固有要素をテストしている。**

Google 化後の関数に対応するテストに全面書き換える。

**モック対象:**

```typescript
vi.mock('googleapis', () => ({
    google: {
        auth: { OAuth2: class { setCredentials() {} } },
        tasks: vi.fn(() => ({
            tasks: {
                list:   mock_tasks_list,
                insert: mock_tasks_insert,
                delete: mock_tasks_delete,
                update: mock_tasks_update,
            },
        })),
        calendar: vi.fn(() => ({
            events: { insert: mock_cal_insert },
        })),
    },
}));
vi.mock('../src/google', () => ({ createOAuthClient: vi.fn(() => ({})) }));
```

**`GoogleTaskItem` ファクトリ関数:**

```typescript
function make_task(
    id: string,
    title: string,
    listId: string,
    status: 'needsAction' | 'completed' = 'needsAction'
): GoogleTaskItem {
    return { id, title, listId, status };
}
```

**必要なテストケース（約18件）:**

`get_next_monday` (3件): 月曜・日曜・金曜の各入力で正しく翌月曜を返す

`get_weekday_date` (2件): オフセット計算が正確（既存テストは `base_monday + 3 = 水曜`、`base_monday + 1 = 月曜` を検証している。この2件はそのまま流用できる）

`archive_current_week` (5件):
- CTASK: 投稿タスク完了済み → `true` を返し全タスク移動（insert + delete が呼ばれる）
- CTASK: 投稿タスク未完了 → `false` を返し移動しない
- CTASK: 投稿タスクが存在しない → `false` を返す
- PTASK（非CTASK）: 投稿タスクがなくてもアーカイブが進む → `true`
- タスクが0件: `true` を返す（チェック対象なし）

`promote_next_week` (3件):
- 来週分にタスクあり → 移動して昇格タスク一覧を返す
- 来週分が空 → 空配列を返す
- `due` が翌月曜に設定されること

`schedule_promoted_tasks` (3件):
- 「プロット」を含むタスク → 水・木の2イベントが作成される（`mock_cal_insert` が2回呼ばれる）
- マトリクス対象外タスク → 月曜 09:00 から順次配置
- タスクが空 → カレンダーAPIが呼ばれない

`generate_next_plot` (2件):
- AI がタスク生成 → `mock_tasks_insert` が呼ばれる
- AI が null 返却 → `mock_tasks_insert` が呼ばれない

**旧テストから削除されるもの:**
- `get_latest_plan` のテスト（3件）: 関数自体が削除されるため
- `PlannerTask` 型を使ったテストすべて

---

## フェーズ 6: 動作検証・最終確認

**目標:** End-to-End の動作をDev環境で確認する。

**前提条件（フェーズ5完了後に実施）:**
- `.env.dev` に `GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`・`GOOGLE_CALENDAR_ID`・`GCP_VERTEX_AI_API_KEY` が設定されていること。
- `npm run google:auth-url` でトークンを取得済みであること（`src/google.ts` の `generateAuthUrl()` と `exchangeCodeAndSave()` を使う）。
- `.google_token.json`（または `GOOGLE_TOKEN_PATH` で指定したパス）にトークンが保存されていること。

---

### タスク 6-1: `gen` コマンドの動作確認

```sh
npm run gen:dev -- "第1話 テスト"
```

確認項目:
- Google Tasks に `gentask_PTASK_来週分` 等のリストが作成されること
- タスクが作成されること
- Google Calendar に対応するイベントが作成されること
- タスクの `notes` にイベントIDが埋め込まれていること
- カレンダーイベントの `extendedProperties.private.gentask_taskId` にタスクIDが設定されていること

---

### タスク 6-2: `sync` コマンドの動作確認

1. Google Calendar で作成されたイベントの本文（description）に「ok」と追記
2. `npm run sync:dev` を実行
3. Google Tasks の該当タスクが `status: completed` になっていること

---

### タスク 6-3: `slide` コマンドの動作確認

1. CTASK の「今週分」リストに「投稿」という名前のタスクを手動で作成し、完了（`completed`）にする
2. `npm run slide:dev -- "第2話 テスト"` を実行
3. 全モードのアーカイブ・昇格・カレンダー配置・次話生成が実行されること

---

### タスク 6-4: アンドゥの動作確認

1. `npm run sync:dev` を実行（何らかのアクションが実行される状態）
2. Google Calendar イベントの本文に `undo` と追記
3. `npm run sync:dev` を再度実行
4. タスクが以前の状態に戻っていること

**注意:** undo の動作はフェーズ3の `snapshot.ts` 設計問題（問題1）の解決方針に依存する。

---

### タスク 6-5: 最終テスト実行

```sh
TZ=Asia/Tokyo npm test
```

全テストがパスすることを確認する。

---

## 実施順序まとめ

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
  型整備    コア      gen化      sync化     slide化    テスト     E2E検証
  env整備   モジュール
```

各フェーズの完了条件を満たしてから次フェーズに進むこと。フェーズ0（型定義の確定）は全フェーズの前提条件。

---

## 注意事項・設計の境界

**Google Tasks の "移動" は API ネイティブ未対応:** リスト間移動は `insert` + `delete` で実現する。移動後はタスクIDが変わるため、カレンダーイベントとのリンクは `schedule_promoted_tasks` で再確立する設計。

**Google Tasks ステータスは二値:** `needsAction` / `completed` のみ。旧コードの `percentComplete`（0 / 50 / 100）を `0` または `100` として扱う。`currentStatus` は後方互換のため数値のまま残す。

**`task_flow` エクスポートは変更禁止:** `bin/index.test.ts` が `task_flow` を直接インポートし、プロンプト文字列を文字列比較でテストしているため、シグネチャ・エクスポート名・プロンプト文字列を変えてはならない。

**スナップショットのキー問題:** `lib/snapshot.ts` の `url` フィールドは Graph API エンドポイント URL として設計されている。Google 化後は `listId` を代わりに格納する形に移行するが、既存のスナップショットファイルとの後方互換は保証されない。既存のスナップショットはフォーマット変更後に無効になる。

**`src/google.ts` のトークン管理:** `createOAuthClient()` はトークンファイルが存在しない場合に警告なく続行する。初回実行時は `npm run google:auth-url` → `npm run google:save-token` の手順が必須。

**テストファイル名と内容の対応確認:** 現行の `bin/index.test.ts` に渡されたファイルの内容が `PlannerSyncService` のテストになっている可能性がある。改修前にファイル名と `describe` ブロックの対応を必ず確認すること。
