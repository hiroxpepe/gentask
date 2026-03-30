# Gentask — Phase 3 実装計画

## 現状（Phase 2 完了）

```
コミット:
c8ae856  feat: Phase 2 — Outlook sync, Open Extensions, AI progress interpretation
e9fd7f2  refactor: Phase 1.5 — fix circular deps, async graph, description deploy
991f541  docs: Create structured README with project philosophy

ファイル構成:
gentask/
├── tsconfig.json    ✅
├── types.ts         ✅ gen_task / outlook_event / sync_action
├── env.ts           ✅ 起動時バリデーション
├── graph.ts         ✅ post / get / patch (async)
├── planner.ts       ✅ デプロイ + Outlook 連携 + Open Extension
├── outlook.ts       ✅ create_event / get_linked_events / build_sync_inputs
├── sync.ts          ✅ sync_flow + PlannerSyncService + CLI エントリ
└── index.ts         ✅ task_flow + CLI エントリ
```

---

## 仕様書との照合 — Phase 3 で対応すべき範囲

| 仕様 (spec_v1.md) | 実装状態 |
|---|---|
| §4 インテリジェント・シンクロナイザー | ✅ Phase 2 で実装 |
| §4 Open Extensions 永続 ID 紐付け | ✅ Phase 2 で実装 |
| **§5 スナップショット・エンジン（記録）** | ❌ 未実装 |
| **§5 Undo トリガー検知（"undo"/"戻して"）** | ❌ 未実装 |
| **§5 復元（書き戻し）** | ❌ 未実装 |
| **§6 日曜 21:00 投稿タスク完了チェック** | ❌ 未実装 |
| **§6 今週分タスクのアーカイブ** | ❌ 未実装 |
| **§6 来週分企画タスクの昇格（スライド）** | ❌ 未実装 |
| **§6 翌週 Outlook カレンダー自動配置** | ❌ 未実装 |
| **§6 次々回話数プロットタスク新規生成** | ❌ 未実装 |

---

## 🚨 設計上の重大な矛盾（Phase 3 着手前に修正必須）

### 問題：バケット構造が spec と一致していない

**現在の実装（planner.ts `ensure_container`）:**
```
Plan: PTASK_20260330_1430
  └── Bucket: "To Do"  ← 1種類のみ
```

**spec §6 が要求する構造:**
```
Plan: CTASK_20260330_1430
  ├── Bucket: "今週分"    ← 製造フェーズのタスクが入る
  ├── Bucket: "来週分"    ← 企画フェーズのタスクが入る（昇格待ち）
  └── Bucket: "完了"      ← アーカイブ先
```

**なぜ問題か:**
- `slide` 機能は「来週分バケットのタスクを今週分バケットに移動」する操作
- 現状は「To Do」1つしかなく、バケット間移動の概念が存在しない
- この修正なしに §6 は実装できない

---

## Phase 3 タスク一覧（適切な粒度）

### 🔴 前提修正（最優先）

| # | タスク | ファイル | 概要 |
|---|---|---|---|
| **T-B1** | バケット構造を3構成に変更 | `planner.ts` | `ensure_container` を「今週分/来週分/完了」の3バケット構成に修正。新規タスクは mode に応じて「今週分」か「来週分」に振り分ける |
| **T-B2** | types.ts に bucket_role 追加 | `types.ts` | `'current' \| 'next' \| 'done'` の bucket_role 型を追加。gen_task に `bucket?: bucket_role` を追加 |

### 📷 スナップショット・エンジン（§5）

| # | タスク | ファイル | 概要 |
|---|---|---|---|
| **T-11** | snapshot.ts 作成 | `snapshot.ts` (新規) | `save(taskId, state)` / `restore(taskId)` / `list_snapshots()` を実装。`~/.gentask/snapshots/` に JSON ファイルで保存 |
| **T-12** | graph.patch に自動スナップショット統合 | `graph.ts` | `patch()` 呼び出し前に自動的に `snapshot.save()` を呼び出す。呼び出し元のコード変更不要 |

### 🔄 Undo 機能（§5）

| # | タスク | ファイル | 概要 |
|---|---|---|---|
| **T-13** | sync_action に 'undo' 追加 | `types.ts` | `sync_action_schema` の action enum に `'undo'` を追加 |
| **T-14** | sync.ts に undo 判定・復元ロジック追加 | `sync.ts` | AI プロンプトに「"undo"/"戻して" → undo」判定を追加。`apply_actions` に `snapshot.restore(taskId)` 呼び出しを追加 |

### 📅 日曜 21:00 自動スライド（§6）

| # | タスク | ファイル | 概要 |
|---|---|---|---|
| **T-15** | slide.ts — 投稿完了チェック＋アーカイブ | `slide.ts` (新規) | 「投稿」タスクの `percentComplete === 100` を確認。今週分バケットの全タスクを完了バケットへ移動（`bucketId` PATCH） |
| **T-16** | slide.ts — 来週分企画タスクの昇格 | `slide.ts` | 来週分バケットの PTASK（プロット・ネーム）を取得し、`bucketId` を今週分に変更 + `startDateTime` を翌月曜に更新 |
| **T-17** | slide.ts — Outlook カレンダー自動配置 | `slide.ts` | 昇格したタスクを spec §3 の週間スケジュール表に従い翌月〜金に Outlook 予定を自動作成（OutlookService 再利用） |
| **T-18** | slide.ts — 次々回話数プロット生成＋コマンド追加 | `slide.ts` + `package.json` | 空いた来週分バケットに task_flow で次々回話数のプロットタスク4ブロックを生成。`slide:dev` / `slide:prod` コマンド追加 |

---

## 依存関係図

```
T-B2 ──→ T-B1          （型追加してから planner.ts 修正）
           │
           ▼
T-11 ──→ T-12          （snapshot 作成してから graph.ts に統合）
           │
           ▼
T-13 ──→ T-14          （型追加してから sync.ts 拡張）
           │
           ▼
T-15 ──→ T-16 ──→ T-17 ──→ T-18   （slide の順番通り）
```

前提修正（T-B1/B2）はスライド機能の前提。スナップショット（T-11/12）は Undo の前提。

---

## 実装順序（推奨）

```
1. T-B2 → T-B1   ← 既存デプロイの挙動が変わるので最初に
2. T-11 → T-12   ← 安全装置を先に用意する
3. T-13 → T-14   ← Undo を sync に組み込む
4. T-15 → T-16 → T-17 → T-18   ← 自動スライドの完成
```

---

## 検証手順（Phase 3 完了後）

```sh
# 1. 型チェック
npx tsc --noEmit

# 2. デプロイ（3バケット構成になっているか確認）
npm run gen:dev -- "第101話の制作"
# → Planner に「今週分」「来週分」「完了」バケットが3つ生成される

# 3. sync 実行（"ok" で完了 → snapshot が保存されているか確認）
npm run sync:dev
# → ~/.gentask/snapshots/ に JSON が生成される

# 4. Undo 確認（"undo" と書いて sync 実行）
npm run sync:dev
# → snapshot から前の状態に戻る

# 5. スライド実行
npm run slide:dev
# → 今週分アーカイブ → 来週分昇格 → Outlook 配置 → 次週プロット生成
```

---

## 注意点・設計上の判断

### T-B1 の後方互換性
- `ensure_container` の変更で、既存のプランには「To Do」のままのものが残る
- 新規デプロイ時のみ3バケット構成になる（既存データを移行しない）

### スナップショットの保存先
- `~/.gentask/snapshots/{taskId}_{timestamp}.json` のローカルファイルで十分
- Phase 4 でクラウドストレージ（GCS）への移行も可能な設計にしておく

### 日曜 21:00 の自動実行
- Phase 3 では `npm run slide:dev` を手動で実行する CLI として実装
- Phase 4 で Cloud Scheduler による自動化を検討
