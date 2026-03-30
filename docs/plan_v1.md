# Gentask — 現状分析・問題点・タスク提案

## 1. 現状把握

### 実装済み（Phase 1 完了）

| ファイル | 役割 | 状態 |
|---|---|---|
| `index.ts` | GenKit Flow + CLI エントリポイント | ✅ 動作 |
| `graph.ts` | `az rest` ラッパー（POST のみ） | ⚠️ 不完全 |
| `planner.ts` | Planner プラン/バケット/タスク作成 | ⚠️ 問題あり |
| `.env.dev` | 開発環境設定（実 ID 入り） | ⚠️ 要注意 |
| `.env.prod` | 本番環境設定（実シークレット入り） | ⚠️ 要注意 |

### アーキテクチャ概略

```
CLI 引数 (subject)
    │
    ▼
index.ts  ─── task_flow (GenKit / Gemini 2.0 Flash)
    │              └─ gen_task[] を出力
    ▼
PlannerService.execute_deployment()
    │
    ▼
graph.post()  ─── az rest ─── Microsoft Graph API ─── M365 Planner
```

### 未実装（spec_v1.md で定義済み）

- Outlook ↔ Planner AI シンクロナイザー
- Open Extensions による永続的 ID 紐付け
- スナップショット + Undo/リカバリ機能
- 日曜 21:00 自動スライド（昇格）プロセス
- 18.0sp / 36-Block ライフサイクル管理全般

---

## 2. 問題点

### 🔴 バグ・クリティカル

#### B-1: `description` フィールドがデプロイされていない
- `task_schema` に `description` を定義し AI に生成させているが、`planner.ts` の `graph.post` 呼び出しにこのフィールドが含まれていない。
- AI が生成した詳細説明がすべて無視されている。

#### B-2: 循環参照 (`planner.ts` ↔ `index.ts`)
- `planner.ts` が `import { gen_task } from './index'` している。
- `index.ts` が `import { PlannerService } from './planner'` している。
- 型定義（`gen_task`, `task_schema`）は独立したファイルに切り出すべき。

#### B-3: `graph.post` が同期処理 (`execSync` ブロッキング)
- `execSync` は Node.js のイベントループをブロックする。
- タスク数が多い場合にパフォーマンスが劣化する。
- `graph` オブジェクト自体が `async` でないため、実際の挙動と型シグネチャが乖離している。

### 🟡 設計上の問題

#### D-1: `graph.ts` に GET / PATCH / DELETE がない
- 現状は POST のみ。
- Phase 2 の Outlook 読み取り・タスク更新・Undo には GET と PATCH が必須。

#### D-2: 環境変数のバリデーションがない
- `M365_USER_ID` が未定義の場合、`this.m365_user_id!` は実行時クラッシュ。
- `M365_PLANNER_${mode}_GROUP_ID` が未定義の場合も同様。
- 起動時に必須変数の存在チェックが必要。

#### D-3: `ensure_container` が実行のたびに新規プランを生成する
- タイムスタンプが `YYYYMMDD_HHMM` 単位のため、同一議題で複数回実行するとプランが乱立する。
- 既存プランの検索・再利用ロジックがない。
- 削除は手動のシェルスクリプトのみで対応。

#### D-4: `tsconfig.json` が存在しない
- `tsx` に完全依存しており、型チェックの厳密度が不明。
- `strict` モードが有効かどうか担保されていない。

### 🟠 セキュリティ

#### S-1: `.env` ファイルに本物のシークレットが含まれている
- `.env.dev` / `.env.prod` は `.gitignore` で除外済み（✅ 正しい）。
- ただし `M365_CLIENT_SECRET`、`GCP_VERTEX_AI_API_KEY` 等の実値がディスク上に平文で存在する。
- ローカル実行環境の破棄・クラウド環境への移行時に Secret Manager 等への移行を検討すること。

#### S-2: `graph.ts` で URL を文字列結合している
- `const cmd = \`az rest --method post --url "${url}" ...\`` はシェルインジェクションのリスクがある。
- URL は内部生成のみなので現状は低リスクだが、将来的に外部入力が入る場合は要注意。

---

## 3. タスク提案

### Phase 1.5 — コード品質・バグ修正（今すぐできる）

| # | タスク | 概要 | 優先度 |
|---|---|---|---|
| T-01 | 型定義の独立ファイル化 | `gen_task`, `task_schema` を `types.ts` に切り出し循環参照を解消 | 🔴 高 |
| T-02 | `description` のデプロイ対応 | `planner.ts` で `taskDetail` を使い `description` を Planner に書き込む | 🔴 高 |
| T-03 | `graph.ts` の非同期化 | `execSync` → `spawnAsync` または `fetch` + `az account get-access-token` へ変更 | 🟡 中 |
| T-04 | `graph.ts` に GET / PATCH 追加 | Phase 2 実装の前提となる通信レイヤーを整備 | 🟡 中 |
| T-05 | 環境変数バリデーション | 起動時に必須変数を一括チェックし、欠損があれば明確なエラーで終了 | 🟡 中 |
| T-06 | `tsconfig.json` の追加 | `strict: true` で型安全性を担保 | 🟢 低 |

### Phase 2 — AI シンクロナイザー（spec_v1.md §4 対応）

| # | タスク | 概要 | 優先度 |
|---|---|---|---|
| T-07 | Open Extensions の実装 | Outlook Event ↔ Planner Task の永続 ID 紐付け | 🔴 高 |
| T-08 | Outlook カレンダー読み取り | Graph API で予定一覧を取得するサービス実装 | 🔴 高 |
| T-09 | AI 進捗判定フロー | Outlook の更新内容を GenKit で解析し Planner に反映する Flow | 🔴 高 |
| T-10 | Planner タスク更新 | PATCH で status / dueDate / assignments を書き換えるメソッド追加 | 🟡 中 |

### Phase 3 — リカバリ & 自動スライド（spec_v1.md §5・§6 対応）

| # | タスク | 概要 | 優先度 |
|---|---|---|---|
| T-11 | スナップショットエンジン | API 操作前の状態を JSON でローカル保存する仕組み | 🟡 中 |
| T-12 | Undo トリガー検知 | Outlook 予定の本文に「undo」が書かれた場合にリストア実行 | 🟡 中 |
| T-13 | 日曜 21:00 自動スライド | cron または Cloud Scheduler で週次昇格プロセスを自動実行 | 🟢 低 |

### Phase 4 — インフラ整備

| # | タスク | 概要 | 優先度 |
|---|---|---|---|
| T-14 | Secret Manager への移行 | GCP Secret Manager / Azure Key Vault でシークレット管理 | 🟡 中 |
| T-15 | Cloud Run / Functions 化 | ローカル CLI から常駐サービスへの移行 | 🟢 低 |
| T-16 | テスト基盤の整備 | Vitest でユニットテスト追加（Flow・PlannerService・graph） | 🟢 低 |

---

## 4. 推奨着手順序

```
T-01 → T-02 → T-05 → T-06   （負債解消・即効性あり）
      ↓
T-03 → T-04                  （通信基盤の整備）
      ↓
T-07 → T-08 → T-09 → T-10   （Phase 2: AI シンク）
      ↓
T-11 → T-12 → T-13           （Phase 3: リカバリ）
      ↓
T-14 → T-15 → T-16           （Phase 4: インフラ）
```

---

## 5. まとめ

Phase 1 の「AI でタスクを生成して Planner に投げる」基盤は動いている。  
次のステップとして **T-01〜T-06 の負債解消**を先に行い、その上で **Phase 2 の双方向シンク**に進むのが最も安全なルートと判断する。

> 「人間が自由に動いた結果を、AI が解釈してシステムを合わせる」（spec_v1.md より）  
> この哲学を実現するには、Phase 2 の Outlook 読み取りと AI 判定フローが核心となる。
