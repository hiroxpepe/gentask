# Gentask

> **週刊漫画連載のための AI 駆動・エネルギー対応タスクオーケストレーション**

Gentask は主に **Microsoft 365（Planner + Outlook）** をサポートします。**Google（Tasks + Calendar）** は補助的／実験的なフローとして実装済みです。Gemini 2.0 Flash（Vertex AI）を GenKit 経由で利用する CLI ツールです。実行するコマンドや設定に応じてバックエンド（デフォルト: Planner）を選択できます。

---

## ✨ 設計思想

> *「管理を意識させない管理」*

作家はカレンダー（Google Calendar または Outlook）という「自由なキャンバス」で作業時間を動かし、メモを書く。Gentask（AI）は、その自由な振る舞いの背後にある「18sp モデルとの差分」を計算し、設定されたタスクバックエンド（Google Tasks か Microsoft Planner）を無言で更新し続ける。

一般的なタスク管理ツールは、優先度と締め切りに最適化されています。  
**Gentask は実行エネルギーと持続可能なクリエイティブ産出に最適化されています。**

---

## 🧠 18sp / 36ブロック 制作モデル

Gentask は 1 話を **18.0sp（18時間）** と定義し、**36 個の 0.5sp（30分）ブロック** に分解して管理します。

| フェーズ | 工程 | sp | ブロック数 | 定義・完了条件 |
|---|---|---|---|---|
| **企画 (P)** | プロット | 2.0 | 4 | 全セリフ・演出意図の言語化 |
| | ラフネーム | 0.5 | 1 | コマ割りと視線誘導の確定 |
| | フルネーム | 0.5 | 1 | 表情・詳細ネームの確定 |
| **製造 (C/T)** | プリレイアウト | 2.0 | 4 | 3D配置前の「設計図」 |
| | 3Dモデル制作 | 3.0 | 6 | ポージング・レンダリング完了 |
| | レイアウト | 3.0 | 6 | カメラ決定・背景合成完了 |
| **仕上げ (C)** | エディット | 2.5 | 5 | 画像加筆・エフェクト処理 |
| | 投稿 | 0.5 | 1 | **日曜 21:00 厳守** |
| **調整** | 予備バッファ | 4.0 | 8 | クオリティアップ・遅延吸収 |

---

## 🗂 タスクモード

タスクは 4 つの実行モードに分類され、それぞれ専用のタスクリスト（Google Tasks または Planner）に対応します：

| モード | 種別 | 説明 | デフォルトバケット |
|---|---|---|---|
| **PTASK** | Planning（企画） | 思考・設計・意思決定 | 来週分 |
| **TTASK** | Technical（技術） | 実装・セットアップ | 今週分 |
| **CTASK** | Creative（制作） | 手を動かす制作作業 | 今週分 |
| **ATASK** | Administrative（事務） | 調整・管理・ルーティン | 今週分 |

各モードは 3 つのバケットを持ちます：

| バケット | ロール | 説明 |
|---|---|---|
| 今週分 | `current` | 今週のアクティブタスク |
| 来週分 | `next` | 次週以降のタスク（企画フェーズ） |
| 完了 | `done` | アーカイブ済み完了タスク |

---

## ⚙️ システムアーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│                      Gentask CLI                         │
│                                                          │
│  gen:dev / gen:prod                                      │
│       │                                                  │
│       ▼                                                  │
│  ┌─────────────┐     AI（Gemini 2.0 Flash / Vertex AI） │
│  │  index.ts   │────► task_flow（GenKit）                │
│  │  タスク生成  │     構造化タスク配列を生成               │
│  └──────┬──────┘                                        │
│         │                                                │
│         ▼                                                │
│  ┌─────────────┐     タスクバックエンドAPI（Microsoft Planner / Google Tasks） / カレンダーAPI（Outlook / Google Calendar） │
│  │ tasks.ts / planner.ts │────► タスクリスト / バケット / タスク作成         │
│  │ デプロイ    │────► カレンダーイベントと連携          │
│  └──────┬──────┘                                        │
│         │                                                │
│         ▼                                                │
│  ┌─────────────┐     カレンダーAPI（Outlook / Google Calendar）                 │
│  │ calendar.ts / outlook.ts │────► カレンダーイベント読み取り         │
│  └──────┬──────┘                                        │
│         │                                                │
│         ▼                                                │
│  ┌─────────────┐     AI（Gemini 2.0 Flash / Vertex AI） │
│  │   sync.ts   │────► イベント → アクション解釈          │
│  │ AI シンク   │────► Tasks を PATCH                    │
│  └─────────────┘                                        │
│                                                          │
│  slide:dev / slide:prod                                  │
│       │                                                  │
│       ▼                                                  │
│  ┌─────────────┐     タスクバックエンド / カレンダー            │
│  │   slide.ts  │────► アーカイブ → 昇格 → スケジュール  │
│  │ 週次スライド │────► 次話プロット生成                   │
│  └─────────────┘                                        │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 機能詳細

### 1. AI タスク生成（`gen`）
題材（例：「第42話 最終決戦」）を入力すると、Gemini 2.0 Flash（Vertex AI）を GenKit 経由で利用して P/T/C/A の構造化タスク一覧を生成します。タスクは即座に設定されたタスクバックエンドへデプロイされ（デフォルト: Microsoft Planner）、カレンダーイベント（Outlook または Google Calendar）と連携されます。

> NOTE: 現在、bin/index.ts と src/planner.ts / src/container_manager.ts は Microsoft Planner を主要フローとして想定しています。Google 環境を利用する場合は `bin/google.ts` のヘルパーコマンドをお使いください。

### 2. インテリジェント AI シンクロナイザー（`sync`）
カレンダーのイベント（Google Calendar または Outlook）を読み取り、AI が自由記述のメモを構造化された進捗シグナルとして解釈します：

| カレンダーでのユーザー行動 | AI の解釈 | タスクへの反映 |
|---|---|---|
| 本文に「ok」と記入 | 「この30分枠は完了した」 | 該当タスクを完了（100%）に |
| 予定を30分後ろにずらした | 「作業時間がスライドした」 | 期限を自動修正 |
| 「手が止まった。明日やる」と記入 | 「未完了・要リスケ」 | 翌日の空き枠へ移動 |
| 「神回。倍の時間かけた」と記入 | 「バッファ消費」 | 予備バッファタスクを相殺 |

対応シンクアクション：`complete`、`reschedule`、`add_note`、`buffer_consumed`、`no_change`、`undo`

### 3. スナップショット & アンドゥ
すべてのタスク更新の直前に、タスクの現在状態が JSON スナップショットとして `~/.gentask/snapshots/{taskId}.json` に保存されます。巻き戻すには：連携しているカレンダーイベントの本文に `undo` または `戻して` と記入し、`npm run sync:dev` を実行してください。

### 4. 週次スライド（日曜 21:00 プロセス）
`slide` コマンドが話数移行の「儀式」を自動化します：

1. **判定** — 「投稿」タスクが 100% 完了しているか確認
2. **アーカイブ** — 今週分の全タスクを「完了」バケットへ移動
3. **昇格（スライド）** — 来週分バケットの企画タスクを「今週分」へ移動
4. **スケジュール** — 昇格したタスクを月〜金のカレンダー（Outlook または Google Calendar）に自動配置
5. **新規生成** — AI が次々回話数のプロットタスクを「来週分」バケットに生成

### 5. 双方向 Open Extensions
すべてのカレンダーイベントとタスクに相互参照が埋め込まれます：
- Calendar イベント：`{ "taskId": "xyz-123" }`
- Task：`{ "eventId": "evt-789" }`

これにより、ユーザーがイベントやタスクのタイトルを書き換えても同期が壊れません。

---

## 🛠 必要環境

| ツール | 用途 |
|---|---|
| `node` ≥ 18 | ランタイム |
| `gcloud`（Google Cloud SDK） | Google API と認証 |
| Google アカウント | Tasks + Calendar アクセス |
| Google Vertex AI API キー | Gemini 2.0 Flash via GenKit |

---

## ⚙️ 環境設定

`.env.dev`（および必要に応じて `.env.prod`）を作成します：

```env
PROJECT_ENV=DEV

# Google Cloud
GCP_PROJECT_ID=your-gcp-project-id
GCP_VERTEX_AI_API_KEY=your-google-ai-api-key

# OAuth (Google) - Calendar/Tasks API 用
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx

# 任意: タスクリスト ID（タスクモードごとに）
GENTASK_TASKLIST_PTASK_ID=xxxxxxxxxxxxxxxx
GENTASK_TASKLIST_TTASK_ID=xxxxxxxxxxxxxxxx
GENTASK_TASKLIST_CTASK_ID=xxxxxxxxxxxxxxxx
GENTASK_TASKLIST_ATASK_ID=xxxxxxxxxxxxxxxx
```

> ⚠️ `.env.*` ファイルはリポジトリにコミットしないでください。

実行前に Google Cloud SDK で認証します：

```sh
gcloud auth login
gcloud config set project $GCP_PROJECT_ID
```

---

## 📦 インストール

```sh
npm install
```

---

## ▶️ 使い方

### タスクの生成とデプロイ

```sh
# 題材からタスクを生成してタスクバックエンドにデプロイ（開発環境）
npm run gen:dev -- "第42話 最終決戦"

# 本番環境
npm run gen:prod -- "第42話 最終決戦"
```

実行内容：
- Gemini AI が構造化タスク一覧を生成
- 各モードに 3 バケット（今週分 / 来週分 / 完了）のリスト/プランを作成
- 正しいリスト/バケットにタスクをデプロイ
- 連携するカレンダーイベント（Outlook または Google Calendar）を作成
- タスクとイベント間の相互参照メタデータを保存

### AI シンク（Calendar から Tasks に進捗反映）

```sh
# カレンダーイベントを読み取り Tasks/Planner に進捗反映（開発環境）
npm run sync:dev

# 本番環境
npm run sync:prod
```

AI が生成したアクション一覧を確認後、適用します。

### 週次スライド（話数移行）

```sh
# 週次スライドを実行（開発環境）
npm run slide:dev

# 本番環境
npm run slide:prod
```

日曜 21:00 の投稿後に実行します。今週のアーカイブ、企画タスクの昇格、来週カレンダーへの配置、次話プロットの生成が自動で行われます。

### テスト実行

```sh
# 全ユニットテストを実行
npm test

# ウォッチモード
npm run test:watch
```

---

## 🗃 プロジェクト構成

```
gentask/
├── bin/               # エントリーポイント / CLI スクリプト（例: gen-google.ts, sync-google.ts）
├── lib/               # API ラッパーとユーティリティ（google-auth.ts, google-tasks.ts, google-calendar.ts）
├── src/               # コアビジネスロジック（ai-flow.ts, sync-rules.ts, types.ts）
├── tools/             # デプロイや補助スクリプト
├── *.test.ts          # Vitest ユニットテスト
├── vitest.config.ts   # Vitest 設定（ESM）
│
├── .env.dev           # 開発環境設定（コミット不可）
├── .env.prod          # 本番環境設定（コミット不可）
├── package.json
└── tsconfig.json
```

---

## 🔁 週次ワークフロー

```
月曜日
  │  npm run gen:dev -- "第N+1話"  ← 今週の制作タスクをデプロイ
  │
月〜日
  │  カレンダー（Google Calendar または Outlook）で作業（ブロックを動かし、メモを書く）
  │
  │  npm run sync:dev  ← いつでも実行して進捗をタスクバックエンドに反映
  │
日曜 21:00
  │  投稿完了 ✅
  │
  │  npm run slide:dev  ← アーカイブ・昇格・スケジュール・次話生成
  ▼
翌月曜日  ← 準備完了
```

---

## 🔄 アンドゥ / リカバリ

最後のシンク操作を取り消すには：

1. 連携しているカレンダーイベントを開く
2. 本文のどこかに `undo` または `戻して` と記入
3. `npm run sync:dev` を実行

Gentask がアンドゥシグナルを検出し、スナップショットからタスクを復元して以前の状態に書き戻します。

---

## 🧪 テスト

Gentask は **Vitest** を使用し、ESM および TypeScript に完全対応しています。

```sh
npm test
```

| ファイル | テスト数 |
|---|---|
| `types.test.ts` | 12 |
| `env.test.ts` | 3 |
| `snapshot.test.ts` | 7 |
| `graph.test.ts` | 6 |
| `outlook.test.ts` | 6 |
| `planner.test.ts` | 4 |
| `sync.test.ts` | 8 |
| `slide.test.ts` | 12 |
| `index.test.ts` | 2 |
| **合計** | **60** |

---

## 📄 ライセンス

MIT
