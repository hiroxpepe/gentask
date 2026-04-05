# Gentask — Phase 3 実装計画

## 現状（Phase 2 完了）

---

## 仕様書との照合 — Phase 3 で対応すべき範囲

---

## 🚨 設計上の重大な矛盾（Phase 3 着手前に修正必須）

### 問題：バケット構造が spec と一致していない

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

---

## 依存関係図

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

# 3. sync 実行（"ok" で完了 → snapshot が保存されているか確認）
npm run sync:dev
# → ~/.gentask/snapshots/ に JSON が生成される

# 4. Undo 確認（"undo" と書いて sync 実行）
npm run sync:dev
# → snapshot から前の状態に戻る

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
