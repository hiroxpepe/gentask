# Gentask — Phase 2 実装計画

## 現状（Phase 1.5 完了）

```
コミット: 412a9fd  "refactor: Phase 1.5 — fix circular deps, async graph, description deploy"

---

## Phase 2 ゴール

---

## 新規アーキテクチャ

---

## 追加型定義 (types.ts に追記)

---

## タスク一覧

---

## 実装詳細

  get_linked_events()
    → GET /me/events?$filter=...
    → 拡張フィールドを持つ予定だけを返す
```

### T-09: sync.ts

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

