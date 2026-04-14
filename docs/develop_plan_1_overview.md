# Gentask Google化改修計画

> ⚠️ **HISTORICAL DOCUMENT — All phases described herein are now fully implemented.**

> **目的:** Microsoft 365（Planner / Outlook / Microsoft Graph）を完全撤去し、Google Tasks + Google Calendar のみを使用するシステムへ全面改修する。

---

## 改修の全体方針

### 現状

- M365 依存のファイル（`src/planner.ts`, `src/container_manager.ts`, `lib/graph.ts`, `lib/outlook.ts` およびそれぞれのテスト）は既に削除済み。
- `bin/index.ts`, `bin/sync.ts`, `bin/slide.ts` はM365依存のインポートが残っており、コンパイル・実行できない状態。
- `lib/types.ts` にM365固有の型名が残っている（`plannerTaskId`, `outlookEventId`, `outlook_event` 型）。
- `lib/env.ts` の必須変数がM365仕様のまま（`M365_USER_ID`, `M365_PLANNER_*_GROUP_ID`）。

### 完了後の姿

- バックエンドが Google Tasks + Google Calendar に統一される。
- 12 個の Google Tasks リスト（`gentask_{MODE}_{バケット名}`）でタスクを管理。
- Google Calendar と Google Tasks が双方向リンクで結ばれ、`sync` コマンドで自動同期される。
- 全テストが Google API モックで通過する。

---

## フェーズ 0: 型定義・環境変数の整備

**目標:** 全モジュールが依存する基盤型を Google 仕様に更新し、コンパイルエラーの起点を解消する。

### タスク 0-1: `lib/types.ts` の更新

**変更箇所:**

1. `outlook_event` 型を削除する（45〜52行目）。
2. `sync_action_schema` の `plannerTaskId` フィールドを `taskId` にリネームする。
   ```typescript
   // Before
   plannerTaskId: z.string().describe('操作対象の Planner タスク ID')
   // After
   taskId: z.string().describe('操作対象の Google Tasks タスク ID')
   ```
3. `sync_input_item` 型を以下に変更する。
   ```typescript
   // Before
   export type sync_input_item = {
       outlookEventId: string;
       plannerTaskId:  string;
       subject:        string;
       bodyContent:    string;
       currentStatus:  number;
   };
   // After
   export type sync_input_item = {
       eventId:        string;   // Google Calendar イベント ID
       taskId:         string;   // Google Tasks タスク ID
       listId:         string;   // Google Tasks リスト ID（新規追加）
       subject:        string;
       bodyContent:    string;
       currentStatus:  number;   // 0=未完了, 100=完了（Google Tasks は二値）
   };
   ```

### タスク 0-2: `lib/env.ts` の更新

`REQUIRED_VARS` 配列を以下に置き換える。

```typescript
const REQUIRED_VARS = [
    'GCP_VERTEX_AI_API_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_CALENDAR_ID',
] as const;
```

### タスク 0-3: `lib/types.test.ts` の更新

`sync_action_schema` のテストで `plannerTaskId` を使用している箇所を `taskId` にすべて置き換える。（計 5 箇所）

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

**完了条件:** `TZ=Asia/Tokyo npm test` で `lib/types.test.ts` と `lib/env.test.ts` がすべて通過すること。

---

## フェーズ 1: Google コアモジュールの整備

**目標:** Google Tasks / Calendar 操作の中核となる `src/google-container-manager.ts` を新規作成し、`src/google.ts` の拡張も行う。

### タスク 1-1: `src/google-container-manager.ts` を新規作成する

**役割:** 4モード × 3バケット = 12 個の Google Tasks リストのライフサイクルを管理する。

**仕様:**

```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';
import { google } from 'googleapis';
import type { bucket_role } from '../lib/types';

// キャッシュファイルのパス
const CACHE_FILE = path.join(os.homedir(), '.gentask', 'tasklists.json');

// バケットロール → リスト名のサフィックス
const BUCKET_LABELS: Record<bucket_role, string> = {
    current: '今週分',
    next:    '来週分',
    done:    '完了',
};

export class GoogleContainerManager {
    private cache: Record<string, Record<bucket_role, string>> = {};

    constructor() {
        // 起動時にキャッシュファイルを読み込む
    }

    /**
     * 指定モードの { current, next, done } リストIDを返す。
     * キャッシュになければ Google Tasks API でリストを検索し、
     * 存在しない場合は新規作成してキャッシュに保存する。
     */
    async get_container(mode: string, auth: any): Promise<Record<bucket_role, string>>
}
```

**処理フロー:**
1. キャッシュ（`~/.gentask/tasklists.json`）に `mode` のエントリが存在すれば即座に返す。
2. `tasklists.list` で既存リストを全件取得し、`gentask_{MODE}_{バケット名}` に一致するものを探す。
3. 見つかったリストはそのIDを使用。見つからないリストは `tasklists.insert` で新規作成。
4. 全3バケット分のIDを `Record<bucket_role, string>` としてキャッシュに保存し返す。

**完了条件:** このファイルが TypeScript としてエラーなくコンパイルできること。（テストは Phase 5 で追加）

---

## フェーズ 2: `bin/index.ts` の Google 化

**目標:** タスク生成・デプロイを Google Tasks + Google Calendar に切り替える。

### タスク 2-1: 不要インポートの削除

`import { PlannerService } from '../src/planner';` を削除する。

### タスク 2-2: デプロイ処理の書き換え

エントリポイントの `(async () => {...})()` 内のデプロイ部分（現在の `PlannerService.execute_deployment` 呼び出し）を以下のロジックに置き換える。

```
各 gen_task について:
  1. createOAuthClient() で auth を取得
  2. GoogleContainerManager.get_container(task.mode, auth) でリストIDを取得
  3. bucket = task.bucket ?? (task.mode === 'PTASK' ? 'next' : 'current')
  4. tasks.tasks.insert({ tasklist: container[bucket], requestBody: { title, notes: description } })
     → taskId を取得
  5. calendar.events.insert({
       calendarId: process.env.GOOGLE_CALENDAR_ID,
       requestBody: {
         summary: `[${task.mode}] ${task.title}`,
         description: task.description,
         start: { dateTime: <30分後> },
         end:   { dateTime: <60分後> },
         extendedProperties: {
           private: { gentask_taskId: taskId, gentask_listId: container[bucket] }
         }
       }
     })
     → eventId を取得
  6. tasks.tasks.update({
       tasklist: container[bucket], task: taskId,
       requestBody: {
         id: taskId, title: task.title,
         notes: `${task.description}\n[gentask:{"eventId":"${eventId}","calendarId":"${calendarId}","listId":"${container[bucket]}"}]`
       }
     })
```

**追加インポート:**
```typescript
import { google } from 'googleapis';
import { createOAuthClient } from '../src/google';
import { GoogleContainerManager } from '../src/google-container-manager';
```

**保持するもの:**
- `task_flow` の export（`bin/index.test.ts` が依存しているため変更禁止）
- `task_schema`, `gen_task` の export

**完了条件:** `npm run gen:dev -- "テスト"` がエラーなく実行でき、Google Tasks と Google Calendar にアイテムが作成されること。

---

## フェーズ 3: `bin/sync.ts` の Google 化

**目標:** `PlannerSyncService` を `GoogleSyncService` に置き換え、カレンダー読取と Tasks 更新をすべて Google API に切り替える。

### タスク 3-1: インポートの更新

削除するインポート:
```typescript
import { OutlookService } from '../lib/outlook';
import { graph } from '../lib/graph';
```

追加するインポート:
```typescript
import { google } from 'googleapis';
import { createOAuthClient } from '../src/google';
```

### タスク 3-2: `sync_flow` の inputSchema 更新

```typescript
// Before
inputSchema: z.array(z.object({
    outlookEventId: z.string(),
    plannerTaskId:  z.string(),
    subject:        z.string(),
    bodyContent:    z.string(),
    currentStatus:  z.number(),
})),
// After
inputSchema: z.array(z.object({
    eventId:       z.string(),
    taskId:        z.string(),
    listId:        z.string(),
    subject:       z.string(),
    bodyContent:   z.string(),
    currentStatus: z.number(),
})),
```

プロンプト内の `item.plannerTaskId` を `item.taskId` に変更する。

### タスク 3-3: `PlannerSyncService` → `GoogleSyncService` に書き換え

**新しいクラス定義:**

```typescript
export class GoogleSyncService {
    async apply_actions(
        actions: sync_action[],
        list_map: Map<string, string>  // taskId → listId
    ): Promise<void>
}
```

**各アクションの実装:**

| アクション | Google Tasks API 操作 |
| :--- | :--- |
| `no_change` | スキップ |
| `complete` | `tasks.tasks.update({ requestBody: { id, status: 'completed' } })` |
| `reschedule` | `tasks.tasks.update({ requestBody: { id, due: newDueDate } })` |
| `add_note` / `buffer_consumed` | `tasks.tasks.get` → `notes` に追記 → `tasks.tasks.update` |
| `undo` | `snapshot.restore(taskId)` → 取得したフィールドで `tasks.tasks.update` |

**`list_map` が存在しない `taskId` は警告ログを出してスキップする。**

### タスク 3-4: `main()` 関数の書き換え

```
1. createOAuthClient() で auth 取得
2. calendar.events.list({
     calendarId: GOOGLE_CALENDAR_ID,
     timeMin: 2週間前のISO文字列,
     privateExtendedProperty: 'gentask_taskId',
     singleEvents: true
   }) でイベント取得
3. 各イベントから extendedProperties.private の gentask_taskId / gentask_listId を取得
4. tasks.tasks.get({ tasklist: listId, task: taskId }) でステータス取得
5. sync_inputs: sync_input_item[] と list_map: Map<string,string> を構築
6. sync_flow(sync_inputs) でアクション生成
7. sync_svc.apply_actions(actions, list_map) で適用
```

**完了条件:** `npm run sync:dev` がエラーなく実行でき、「No linked events found.」または正常な同期結果が表示されること。

---

## フェーズ 4: `bin/slide.ts` の Google 化

**目標:** M365 依存をすべて削除し、Google Tasks + Google Calendar で週次スライドを実現する。

### タスク 4-1: 不要コードの削除

以下をすべて削除する:
- `import { graph } from '../lib/graph'`
- `import { OutlookService } from '../lib/outlook'`
- `const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'`
- `PlannerTask` インターフェース
- `PlannerBucket` インターフェース
- `get_latest_plan()` 関数（M365固有）
- `get_buckets()` 関数（M365固有）
- `get_tasks_in_bucket()` 関数（M365固有）
- `move_task()` 旧実装

エントリポイントのループ内の `M365_PLANNER_${mode}_GROUP_ID` 参照も削除。

### タスク 4-2: 新規型・ヘルパー関数の追加

**`GoogleTaskItem` インターフェース（export）:**
```typescript
export interface GoogleTaskItem {
    id:      string;
    title:   string;
    notes?:  string;
    status:  'needsAction' | 'completed';
    due?:    string;
    listId:  string;  // どのリストに属するか
}
```

**`get_tasks_in_list(listId, auth)` ヘルパー（非export）:**
```typescript
// tasks.tasks.list({ tasklist: listId, showCompleted: false }) を呼び、
// GoogleTaskItem[] に変換して返す
```

**`move_task(task, sourceListId, targetListId, auth, overrides?)` ヘルパー（非export）:**
```typescript
// 1. tasks.tasks.insert({ tasklist: targetListId, requestBody: { title, notes, due, ...overrides } })
// 2. tasks.tasks.delete({ tasklist: sourceListId, task: task.id })
// 新しく作成されたタスクの GoogleTaskItem を返す
```

### タスク 4-3: `archive_current_week` の書き換え

**新しいシグネチャ:**
```typescript
export async function archive_current_week(
    container: Record<bucket_role, string>,
    auth: any,
    mode: string
): Promise<boolean>
```

**処理:**
1. `get_tasks_in_list(container.current, auth)` でタスク一覧取得。
2. **`mode === 'CTASK'` の場合のみ**、タイトルに「投稿」を含むタスクを検索し、`status !== 'completed'` なら `false` を返す。
3. 全タスクを `move_task(task, container.current, container.done, auth)` で移動。
4. `true` を返す。

> ⚠️ PTASK / TTASK / ATASK は「投稿」チェックを行わない。

### タスク 4-4: `promote_next_week` の書き換え

**新しいシグネチャ:**
```typescript
export async function promote_next_week(
    container: Record<bucket_role, string>,
    auth: any
): Promise<GoogleTaskItem[]>
```

**処理:**
1. `get_tasks_in_list(container.next, auth)` でタスク一覧取得。
2. `get_next_monday()` で翌月曜日を算出。
3. 各タスクを `move_task(task, container.next, container.current, auth, { due: nextMonday.toISOString() })` で移動。
4. 新規作成されたタスク（新しいID）の一覧を返す。

### タスク 4-5: `schedule_promoted_tasks` の書き換え

**新しいシグネチャ:**
```typescript
export async function schedule_promoted_tasks(
    tasks: GoogleTaskItem[],
    auth: any
): Promise<void>
```

**処理:**
1. `PLANNING_SCHEDULE` に一致するタスクは指定曜日・時刻で `calendar.events.insert`。
2. それ以外は月曜 09:00 から 30 分ブロックで順次 `calendar.events.insert`。
3. 各イベント作成後、`tasks.tasks.update` でタスクの `notes` に双方向リンクを追記する:
   ```
   [gentask:{"eventId":"<eventId>","calendarId":"<calendarId>","listId":"<listId>"}]
   ```

### タスク 4-6: `generate_next_plot` の書き換え

**新しいシグネチャ:**
```typescript
export async function generate_next_plot(
    container: Record<bucket_role, string>,
    episode_hint: string,
    auth: any
): Promise<void>
```

**処理:**
1. AI で `task_schema[]` を生成（最大4件）。
2. 各タスクを `tasks.tasks.insert({ tasklist: container.next, requestBody: { title, notes: description } })` で挿入。

### タスク 4-7: エントリポイントの書き換え

```typescript
const auth    = createOAuthClient();
const manager = new GoogleContainerManager();

for (const mode of MODES) {
    const container = await manager.get_container(mode, auth);

    const archived = await archive_current_week(container, auth, mode);
    if (!archived) continue;

    const promoted = await promote_next_week(container, auth);
    if (promoted.length > 0) {
        await schedule_promoted_tasks(promoted, auth);
    }

    if (mode === 'PTASK') {
        await generate_next_plot(container, episode_hint, auth);
    }
}
```

**完了条件:** `npm run slide:dev` がエラーなく実行でき、全モードのスライド処理が完了すること。

---

## フェーズ 5: テストの全面更新

**目標:** 削除・変更に伴いコンパイルエラーになっているテストを修正し、全テストがパスすること。

### タスク 5-1: `bin/sync.test.ts` の全面書き換え

**モック対象:**
```typescript
vi.mock('googleapis', () => ({
    google: {
        auth: { OAuth2: class { setCredentials(){} } },
        tasks: () => ({
            tasks: {
                get:    mock_tasks_get,
                update: mock_tasks_update,
            }
        }),
    }
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
| `add_note` は既存ノートに追記して update | `requestBody.notes` に新旧両方のテキストが含まれること |
| `buffer_consumed` もノートに追記して update | 同上 |
| `undo` はスナップショットから状態を復元して update | `mock_restore` が呼ばれ、`mock_tasks_update` が呼ばれること |

### タスク 5-2: `bin/slide.test.ts` の全面書き換え

**モック対象:**
```typescript
vi.mock('googleapis', () => ({
    google: {
        auth: { OAuth2: class { setCredentials(){} } },
        tasks: () => ({
            tasks: {
                list:   mock_tasks_list,
                insert: mock_tasks_insert,
                delete: mock_tasks_delete,
                update: mock_tasks_update,
            }
        }),
        calendar: () => ({
            events: { insert: mock_cal_insert }
        }),
    }
}));
vi.mock('../src/google', () => ({ createOAuthClient: vi.fn(() => ({})) }));
```

**`GoogleTaskItem` ファクトリ関数:**
```typescript
function make_task(id: string, title: string, listId: string, status: 'needsAction' | 'completed' = 'needsAction'): GoogleTaskItem
```

**必要なテストケース（約18件）:**

- `get_next_monday` (3件): 月曜・日曜・金曜の各入力で正しく翌月曜を返す
- `get_weekday_date` (2件): オフセット計算が正確
- `archive_current_week` (5件):
  - CTASK: 投稿タスク完了済み → `true` を返し全タスク移動
  - CTASK: 投稿タスク未完了 → `false` を返し移動しない
  - CTASK: 投稿タスクが存在しない → `false` を返す
  - PTASK（非CTASK）: 投稿タスクがなくてもアーカイブが進む → `true`
  - タスクが0件: `true` を返す（チェック対象なし）
- `promote_next_week` (3件):
  - 来週分にタスクあり → 移動して昇格タスク一覧を返す
  - 来週分が空 → 空配列を返す
  - `due` が翌月曜に設定されること
- `schedule_promoted_tasks` (3件):
  - 「プロット」を含むタスク → 水・木の 2 イベントが作成される
  - マトリクス対象外タスク → 月曜 09:00 から順次配置
  - タスクが空 → カレンダーAPIが呼ばれない
- `generate_next_plot` (2件):
  - AI がタスク生成 → `tasks.insert` が呼ばれる
  - AI が null 返却 → `tasks.insert` が呼ばれない

**完了条件:** `TZ=Asia/Tokyo npm test` で全テストがパスすること（~64件）。

---

## フェーズ 6: 動作検証・最終確認

**目標:** End-to-End の動作をDev環境で確認する。

### タスク 6-1: `gen` コマンドの動作確認

```sh
npm run gen:dev -- "第1話 テスト"
```

- [ ] Google Tasks の `gentask_PTASK_来週分` などに正しいリストが作成されること
- [ ] タスクが作成されること
- [ ] Google Calendar に対応するイベントが作成されること
- [ ] タスクの `notes` にイベントIDが埋め込まれていること
- [ ] カレンダーイベントの `extendedProperties.private.gentask_taskId` にタスクIDが設定されていること

### タスク 6-2: `sync` コマンドの動作確認

1. Google Calendar で作成されたイベントの本文に「ok」と追記
2. `npm run sync:dev` を実行
3. Google Tasks の該当タスクが `status: completed` になっていること

### タスク 6-3: `slide` コマンドの動作確認

1. CTASK の「今週分」リストに「投稿」という名前の完了済みタスクを手動で作成
2. `npm run slide:dev -- "第2話 テスト"` を実行
3. 全モードのアーカイブ・昇格・カレンダー配置・次話生成が実行されること

### タスク 6-4: アンドゥの動作確認

1. `npm run sync:dev` を実行（何らかのアクションが実行される状態）
2. Google Calendar イベントの本文に `undo` と追記
3. `npm run sync:dev` を再度実行
4. タスクが以前の状態に戻っていること

### タスク 6-5: 最終テスト実行

```sh
TZ=Asia/Tokyo npm test
```

全テスト（~64件）がパスすることを確認する。

---

## 実施順序まとめ

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
  型整備    コア      gen化      sync化     slide化    テスト     検証
  env整備   モジュール
```

各フェーズの完了条件を満たしてから次フェーズに進むこと。特にフェーズ 0 完了（型定義の確定）は全フェーズの前提条件。

---

## 注意事項・設計の境界

- **Google Tasks の "移動" は API ネイティブ未対応:** リスト間移動は `insert` + `delete` で実現。移動後はタスクIDが変わるため、カレンダーイベントとのリンクは `schedule_promoted_tasks` で再確立する設計。
- **Google Tasks ステータスは二値:** `needsAction` / `completed` のみ。`currentStatus` は `0` または `100` として扱う。
- **`task_flow` エクスポートは変更禁止:** `bin/index.test.ts` が `task_flow` を直接インポートしてテストしているため、シグネチャ・エクスポート名を変えてはならない。
- **スナップショットのキー:** M365 時代は `url` をキーとしていたが、Google化後は `taskId` をキーとする（`lib/snapshot.ts` の仕様確認が必要）。
