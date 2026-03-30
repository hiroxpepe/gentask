# Gentask

> **週刊漫画連載のための AI 駆動・エネルギー対応タスクオーケストレーション**

Gentask は **Microsoft 365 Planner** と **Outlook** を **Gemini 2.0 Flash AI** と統合する CLI ツールです。週刊漫画連載の過酷な制作サイクルを、自動的・知的・最小摩擦で管理します。

---

## ✨ 設計思想

> *「管理を意識させない管理」*

作家は Outlook という「自由なキャンバス」で作業時間を動かし、メモを書く。Gentask（AI）は、その自由な振る舞いの背後にある「18sp モデルとの差分」を計算し、Planner という「厳格な帳簿」を無言で更新し続ける。

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

タスクは 4 つの実行モードに分類され、それぞれ専用の Microsoft 365 Planner プランに対応します：

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
│  ┌─────────────┐     AI（Gemini 2.0 Flash）             │
│  │  index.ts   │────► task_flow（GenKit）                │
│  │  タスク生成  │     構造化タスク配列を生成               │
│  └──────┬──────┘                                        │
│         │                                                │
│         ▼                                                │
│  ┌─────────────┐     MS Graph API（az rest 経由）       │
│  │ planner.ts  │────► プラン / バケット / タスク作成     │
│  │ デプロイ    │────► Outlook イベント連携（Open Ext.）  │
│  └─────────────┘                                        │
│                                                          │
│  sync:dev / sync:prod                                    │
│       │                                                  │
│       ▼                                                  │
│  ┌─────────────┐     MS Graph API                       │
│  │  outlook.ts │────► カレンダーイベント読み取り          │
│  └──────┬──────┘                                        │
│         │                                                │
│         ▼                                                │
│  ┌─────────────┐     AI（Gemini 2.0 Flash）             │
│  │   sync.ts   │────► イベント → アクション解釈          │
│  │ AI シンク   │────► Planner タスクを PATCH             │
│  └─────────────┘                                        │
│                                                          │
│  slide:dev / slide:prod                                  │
│       │                                                  │
│       ▼                                                  │
│  ┌─────────────┐     MS Graph API                       │
│  │   slide.ts  │────► アーカイブ → 昇格 → スケジュール  │
│  │ 週次スライド │────► 次話プロット生成                   │
│  └─────────────┘                                        │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 機能詳細

### 1. AI タスク生成（`gen`）
題材（例：「第42話 最終決戦」）を入力すると、Gemini 2.0 Flash が P/T/C/A の全方位にわたる構造化タスク一覧を生成します。タスクは即座に Microsoft 365 Planner の適切なバケットへデプロイされ、Outlook カレンダーイベントとも連携されます。

### 2. インテリジェント AI シンクロナイザー（`sync`）
Outlook カレンダーのイベントを読み取り、AI が自由記述のメモを構造化された進捗シグナルとして解釈します：

| Outlook でのユーザー行動 | AI の解釈 | Planner への反映 |
|---|---|---|
| 本文に「ok」と記入 | 「この30分枠は完了した」 | 該当タスクを完了（100%）に |
| 予定を30分後ろにずらした | 「作業時間がスライドした」 | 期限を自動修正 |
| 「手が止まった。明日やる」と記入 | 「未完了・要リスケ」 | 翌日の空き枠へ移動 |
| 「神回。倍の時間かけた」と記入 | 「バッファ消費」 | 予備バッファタスクを相殺 |

対応シンクアクション：`complete`、`reschedule`、`add_note`、`buffer_consumed`、`no_change`、`undo`

### 3. スナップショット & アンドゥ
すべての Planner PATCH の直前に、タスクの現在状態が JSON スナップショットとして `~/.gentask/snapshots/{taskId}.json` に保存されます。巻き戻すには：Outlook イベントの本文に `undo` または `戻して` と記入し、`sync` を実行するだけです。

### 4. 週次スライド（日曜 21:00 プロセス）
`slide` コマンドが話数移行の「儀式」を自動化します：

1. **判定** — 「投稿」タスクが 100% 完了しているか確認
2. **アーカイブ** — 今週分の全タスクを「完了」バケットへ移動
3. **昇格（スライド）** — 来週分バケットの企画タスクを「今週分」へ移動
4. **スケジュール** — 昇格したタスクを月〜金の Outlook カレンダーに自動配置
5. **新規生成** — AI が次々回話数のプロットタスクを「来週分」バケットに生成

### 5. 双方向 Open Extensions
すべての Outlook イベントと Planner タスクに相互参照が埋め込まれます：
- Outlook イベント：`{ "plannerTaskId": "xyz-123" }`
- Planner タスク：`{ "outlookEventId": "evt-789" }`

ユーザーがイベントやタスクのタイトルを書き換えても同期は壊れません。

---

## 🛠 必要環境

| ツール | 用途 |
|---|---|
| `node` ≥ 18 | ランタイム |
| `az`（Azure CLI） | `az rest` 経由の MS Graph API 呼び出し |
| Microsoft 365 アカウント | Planner + Outlook アクセス |
| Google AI API キー | GenKit 経由の Gemini 2.0 Flash |

---

## ⚙️ 環境設定

`.env.dev`（および必要に応じて `.env.prod`）を作成します：

```env
PROJECT_ENV=DEV

# Microsoft 365
M365_USER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
M365_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
M365_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
M365_CLIENT_SECRET=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Planner グループ ID（タスクモードごとに 1 つ）
M365_PLANNER_PTASK_GROUP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
M365_PLANNER_TTASK_GROUP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
M365_PLANNER_CTASK_GROUP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
M365_PLANNER_ATASK_GROUP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Google AI（Vertex AI / Gemini）
GCP_VERTEX_AI_API_KEY=your-google-ai-api-key
```

> ⚠️ `.env.*` ファイルはリポジトリにコミットしないでください。

実行前に Azure CLI で認証します：

```sh
az login --tenant <your-tenant-id>
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
# 題材からタスクを生成して Planner にデプロイ（開発環境）
npm run gen:dev -- "第42話 最終決戦"

# 本番環境
npm run gen:prod -- "第42話 最終決戦"
```

実行内容：
- Gemini AI が構造化タスク一覧を生成
- 各モードに 3 バケット（今週分 / 来週分 / 完了）の Planner プランを作成
- 正しいバケットにタスクをデプロイ
- 連携する Outlook カレンダーイベントを作成
- Open Extension に相互参照メタデータを保存

### AI シンク（Outlook から Planner に進捗反映）

```sh
# Outlook イベントを読み取り Planner に進捗反映（開発環境）
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
├── index.ts          # CLI エントリポイント + AI タスク生成フロー
├── types.ts          # Zod スキーマ：タスクモード・シンクアクション・バケットロール
├── env.ts            # 環境変数バリデーション
├── graph.ts          # MS Graph API ラッパー（az rest 経由）
├── planner.ts        # Planner デプロイ：プラン・バケット・タスク・拡張機能
├── outlook.ts        # Outlook：カレンダーイベント・拡張機能・シンク入力ビルダー
├── sync.ts           # AI シンクロナイザー：イベント解釈 → Planner アクション適用
├── snapshot.ts       # スナップショットエンジン：アンドゥ用タスク状態保存/復元
├── slide.ts          # 週次スライド：アーカイブ → 昇格 → スケジュール → 生成
│
├── *.test.ts         # Vitest ユニットテスト（60テスト、9ファイル）
├── vitest.config.ts  # Vitest 設定（ESM、pool: forks）
│
├── .env.dev          # 開発環境設定（コミット不可）
├── .env.prod         # 本番環境設定（コミット不可）
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
  │  Outlook で作業（ブロックを動かし、メモを書く）
  │
  │  npm run sync:dev  ← いつでも実行して進捗を Planner に反映
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

1. 連携している Outlook イベントを開く
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
