# Gentask — Phase 2 実装計画

## 現状（Phase 1.5 完了）

```
コミット: 412a9fd  "refactor: Phase 1.5 — fix circular deps, async graph, description deploy"

ファイル構成:
gentask/
├── tsconfig.json     ✅ 新規：strict: true
├── types.ts          ✅ 新規：task_schema / gen_task（循環参照解消）
├── env.ts            ✅ 新規：起動時 env バリデーション
├── graph.ts          ✅ 更新：async spawn / get() / patch() 追加
├── planner.ts        ✅ 更新：description を plannerTaskDetails に PATCH
├── index.ts          ✅ 更新：types.ts インポート / validate_env() 呼び出し
└── docs/plan_v1.md   ✅ 新規：現状分析・問題点・タスク提案
```

---

## Phase 2 ゴール

> **「AI がシステムを合わせる」の第一歩**
> Gentask がタスクを Planner に作るだけでなく、同時に Outlook カレンダーにも予定を配置し、
> ユーザーが予定に書いたメモを AI が解釈して Planner を自動更新する。

---

## 新規アーキテクチャ

```
■ デプロイ時（npm run gen:dev）
  index.ts
    └─ task_flow（AI生成）
         └─ PlannerService.execute_deployment()
               ├─ graph.post → Planner タスク作成
               ├─ graph.patch → plannerTaskDetails に description 書込
               ├─ OutlookService.create_event() → Outlook カレンダー予定作成
               └─ Open Extension で双方向 ID リンク
                    Planner task.extensions ← { outlookEventId: "..." }
                    Outlook event.extensions ← { plannerTaskId: "..." }

■ 同期時（npm run sync:dev）
  sync.ts
    ├─ OutlookService.get_linked_events() → 紐付き予定を全取得
    ├─ sync_flow（GenKit AI）→ 本文変化を解釈 → sync_action[] 出力
    └─ PlannerSyncService.apply_actions() → Planner に PATCH
```

---

## 追加型定義 (types.ts に追記)

```ts
// Outlook イベントの必要最小構造
outlook_event = {
    id, subject, body.content,
    start.dateTime, end.dateTime,
    extensions: [{ plannerTaskId?: string }]
}

// AI の判定結果
sync_action = {
    plannerTaskId: string,
    action: 'complete' | 'reschedule' | 'add_note' | 'buffer_consumed' | 'no_change',
    note?: string,
    newDueDate?: string   // ISO 8601
}
```

---

## タスク一覧

| # | タスク | ファイル | 依存 |
|---|---|---|---|
| T-08 | OutlookService 実装 | `outlook.ts` (新規) | — |
| T-07 | Open Extensions 実装 | `planner.ts` 更新 + `outlook.ts` | T-08 |
| T-09 | AI 進捗判定フロー | `sync.ts` (新規) | T-07 |
| T-10 | sync コマンド追加 | `package.json` 更新 | T-09 |

---

## 実装詳細

### T-08: outlook.ts

```
OutlookService
  create_event(task, planner_task_id, start_iso, end_iso)
    → POST /me/events
    → 戻り値: outlook event id

  add_extension(event_id, planner_task_id)
    → POST /me/events/{id}/extensions
    → extensionName: "com.gentask.v1"

  get_linked_events()
    → GET /me/events?$filter=...
    → 拡張フィールドを持つ予定だけを返す
```

### T-07: planner.ts 更新

```
execute_deployment() に追加:
  1. Planner タスク作成（既存）
  2. description PATCH（既存）
  3. Outlook イベント作成（T-08）
  4. Outlook イベントに extension 追加（plannerTaskId）
  5. Planner タスクに extension 追加（outlookEventId）
```

### T-09: sync.ts

```
sync_flow (GenKit Flow)
  input: { subject, body, existingStatus }[]
  output: sync_action[]
  prompt: "以下の予定変化を解析し、Planner の更新指示を出力せよ..."

apply_actions(actions)
  → complete: PATCH percentComplete=100
  → reschedule: PATCH dueDateTime
  → add_note: GET details → PATCH description に追記
  → buffer_consumed: no-op（ログのみ）
```

### T-10: package.json

```json
"sync:dev":  "tsx sync.ts dev",
"sync:prod": "tsx sync.ts prod"
```

---

## 検証手順（Phase 2 完了後）

```sh
# 1. 型チェック
npx tsc --noEmit

# 2. タスク生成（Outlook 予定も同時作成されることを確認）
npm run gen:dev -- "週刊連載 第100話の制作"
# → Planner にタスクが並ぶ
# → Outlook カレンダーに予定が並ぶ
# → 双方に extension が付いていることを確認

# 3. Outlook 予定の本文に "ok" と書いて保存

# 4. 同期実行
npm run sync:dev
# → 該当 Planner タスクの percentComplete が 100 になっていることを確認
```
