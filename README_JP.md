# Gentask

> **週刊漫画連載のための AI 駆動・エネルギー対応タスクオーケストレーション**

Gentask は **Google Tasks + Google Calendar** と **Gemini 2.0 Flash（Vertex AI）** を Genkit 経由で統合し、週刊漫画連載の制作サイクルを自動かつインテリジェントに管理する CLI ツールです。

---

## ✨ 設計思想

> *「管理を意識させない管理」*

作家は Google Calendar という「自由なキャンバス」で作業時間を動かし、メモを書く。Gentask（AI）は、その自由な振る舞いの背後にある「18sp モデルとの差分」を計算し、Google Tasks を無言で更新し続ける。

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
| **技術 (T)** | プリレイアウト | 2.0 | 4 | 3D配置前の「設計図」完成 |
| | 3Dモデル制作 | 3.0 | 6 | ポージング・レンダリング完了 |
| | レイアウト | 3.0 | 6 | カメラ決定・背景合成完了 |
| **制作 (C)** | エディット | 2.5 | 5 | 画像加筆・エフェクト処理完了 |
| | 投稿 | 0.5 | 1 | **日曜 21:00 厳守** |
| **調整 (A)** | 予備バッファ | 4.0 | 8 | クオリティアップ・遅延吸収 |

---

## 🗂 タスクモード

タスクは 4 つの実行モードに分類され、それぞれ専用の Google Tasks リストに対応します：

| モード | 種別 | 説明 | デフォルトバケット |
|---|---|---|---|
| **PTASK** | Planning（企画） | 思考・設計・意思決定 | 来週分 |
| **TTASK** | Technical（技術） | 実装・環境構築・セットアップ | 今週分 |
| **CTASK** | Creative（制作） | 手を動かす制作作業 | 今週分 |
| **ATASK** | Administrative（事務） | 調整・管理・ルーティン | 今週分 |

各モードは 3 つの Google Tasks リストを持ちます（計 12 リスト）：

| リスト名（Google Tasks） | ロール（`bucket_role`） | 説明 |
|---|---|---|
| `gentask_{MODE}_今週分` | `current` | 今週のアクティブタスク |
| `gentask_{MODE}_来週分` | `next` | 次週以降のタスク（企画フェーズ） |
| `gentask_{MODE}_完了` | `done` | アーカイブ済み完了タスク |

リストは初回実行時に自動作成され、`~/.gentask/tasklists.json` にキャッシュされます。

---

## ⚙️ システムアーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                      Gentask CLI                             │
│                                                              │
│  gen:dev / gen:prod                                          │
│       │                                                      │
│       ▼                                                      │
│  ┌──────────────┐  Gemini 2.0 Flash（Vertex AI / Genkit）    │
│  │  index.ts    │──► task_flow: 題材 → gen_task[]            │
│  └──────┬───────┘                                            │
│         ▼                                                    │
│  ┌──────────────┐  Google Tasks API                          │
│  │  container   │──► get_container(mode) → {current,next,done}│
│  │  manager     │  （12リスト自動管理・キャッシュ）           │
│  └──────┬───────┘                                            │
│         ▼                                                    │
│  ┌──────────────┐  Google Tasks API + Google Calendar API    │
│  │   deploy     │──► tasks.insert + events.insert            │
│  │              │──► 双方向リンク埋め込み                    │
│  └─────────────┘                                             │
│                                                              │
│  sync:dev / sync:prod                                        │
│       │                                                      │
│       ▼                                                      │
│  ┌──────────────┐  Google Calendar API                       │
│  │   sync.ts    │──► events.list（gentask_taskId フィルタ）   │
│  └──────┬───────┘                                            │
│         ▼                                                    │
│  ┌──────────────┐  Gemini 2.0 Flash（Vertex AI / Genkit）    │
│  │  sync_flow   │──► イベント本文 → sync_action[]            │
│  └──────┬───────┘                                            │
│         ▼                                                    │
│  ┌──────────────┐  Google Tasks API                          │
│  │  apply_      │──► tasks.update（complete/reschedule/undo）│
│  │  actions     │                                            │
│  └─────────────┘                                             │
│                                                              │
│  slide:dev / slide:prod                                      │
│       │                                                      │
│       ▼                                                      │
│  ┌──────────────┐  Google Tasks API + Google Calendar API    │
│  │   slide.ts   │──► アーカイブ→昇格→スケジュール→生成       │
│  └─────────────┘                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 機能詳細

### 1. AI タスク生成（`gen`）

題材（例：「第42話 最終決戦」）を入力すると、Gemini 2.0 Flash（Vertex AI）を Genkit 経由で利用して P/T/C/A の構造化タスク一覧を生成します。タスクは即座に Google Tasks の正しいリストにデプロイされ、Google Calendar とのイベントが双方向リンク付きで作成されます。

### 2. インテリジェント AI シンクロナイザー（`sync`）

Google Calendar のイベント（`gentask_taskId` タグ付き）を読み取り、AI が自由記述のメモを構造化された進捗シグナルとして解釈します：

| カレンダーでのユーザー行動 | AI の解釈 | Google Tasks への反映 |
|---|---|---|
| 本文に「ok」と記入 | 「このブロックは完了した」 | `status → completed` |
| 予定を後ろにずらした | 「作業時間がスライドした」 | `due` 自動修正 |
| 「手が止まった。明日やる」と記入 | 「未完了・要リスケ」 | 翌日の空き枠へ移動 |
| 「神回。倍の時間かけた」と記入 | 「バッファ消費」 | バッファタスクに追記 |

対応シンクアクション：`complete`、`reschedule`、`add_note`、`buffer_consumed`、`no_change`、`undo`

### 3. スナップショット & アンドゥ

すべてのタスク更新の直前に、タスクの現在状態が JSON スナップショットとして `~/.gentask/snapshots/{taskId}.json` に保存されます。巻き戻すには：連携しているカレンダーイベントの本文に `undo` または `戻して` と記入し、`npm run sync:dev` を実行してください。

### 4. 週次スライド（日曜 21:00 プロセス）

`slide` コマンドが話数移行の「儀式」を自動化します：

1. **判定** — CTASK の「投稿」タスクが `status: completed` か確認（他モードはスキップ）
2. **アーカイブ** — 全モードの `今週分` リストのタスクを `完了` リストへ移動
3. **昇格（スライド）** — `来週分` リストのタスクを `今週分` へ移動し `due` を翌月曜に設定
4. **スケジュール** — 昇格タスクを週間マトリクスに従い Google Calendar へ配置
5. **新規生成** — AI が次々回話数のプロットタスク（最大4件）を PTASK `来週分` に生成

### 5. 双方向リンク

すべてのカレンダーイベントとタスクに相互参照が埋め込まれます：

- **タスクのノート**（末尾追記）:
  ```
  [gentask:{"eventId":"…","calendarId":"…","listId":"…"}]
  ```
- **カレンダーイベント**（`extendedProperties.private`）:
  - `gentask_taskId`: Google Tasks タスクID
  - `gentask_listId`: Google Tasks リストID

---

## 🛠 必要環境

| ツール | 用途 |
|---|---|
| `node` ≥ 18 | ランタイム |
| Google アカウント | Google Tasks + Google Calendar アクセス |
| GCP プロジェクト | OAuth 2.0 認証情報 + Vertex AI API キー |

---

## ⚙️ 環境設定

`.env.dev`（および必要に応じて `.env.prod`）を作成します：

```env
# Google Vertex AI（Gemini）
GCP_VERTEX_AI_API_KEY=your-vertex-ai-api-key

# Google OAuth 2.0
GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxx

# 同期対象のカレンダーID
GOOGLE_CALENDAR_ID=your-calendar-id@group.calendar.google.com

# 任意
GOOGLE_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob
GOOGLE_TOKEN_PATH=.google_token.json
```

> ⚠️ `.env.*` ファイルはリポジトリにコミットしないでください。

---

## 📦 インストール

```sh
npm install
```

---

## 🔑 Google OAuth セットアップ（初回のみ）

```sh
# 1. 認可 URL を生成
npm run google:auth-url

# 2. URL をブラウザで開いて認可し、コードをコピー
# 3. コードをトークンに交換（.google_token.json に保存）
npm run google:save-token -- <認可コード>

# 4. アクセス確認
npm run google:list-cals
```

---

## ▶️ 使い方

### タスクの生成とデプロイ

```sh
# 題材からタスクを生成して Google Tasks + Calendar にデプロイ（開発環境）
npm run gen:dev -- "第42話 最終決戦"

# 本番環境
npm run gen:prod -- "第42話 最終決戦"
```

実行内容：
- Gemini AI が P/T/C/A 構造化タスク一覧を生成
- Google Tasks の 12 リストを自動作成（初回のみ）
- 各タスクを正しいリスト（`今週分` / `来週分`）にデプロイ
- Google Calendar に連携イベントを作成
- タスク・イベント間の双方向リンクを埋め込み

### AI シンク（Calendar → Tasks に進捗反映）

```sh
# Google Calendar を読み取り Google Tasks に同期（開発環境）
npm run sync:dev

# 本番環境
npm run sync:prod
```

### 週次スライド（話数移行）

```sh
# 週次スライドを実行（開発環境）
npm run slide:dev -- "第43話 伏線回収"

# 本番環境
npm run slide:prod -- "第43話 伏線回収"
```

日曜 21:00 の投稿後に実行します。

### テスト実行

```sh
# 全ユニットテストを実行（タイムゾーン固定）
TZ=Asia/Tokyo npm test

# ウォッチモード
npm run test:watch
```

---

## 🗃 プロジェクト構成

```
gentask/
├── bin/        # CLIエントリポイント（index.ts / sync.ts / slide.ts / google.ts）
├── lib/        # 共有ライブラリ（types.ts / env.ts / snapshot.ts）
├── src/        # コアロジック（google.ts / google-container-manager.ts）
├── docs/       # プロジェクトドキュメント
├── .env.dev    # 開発環境設定（コミット不可）
├── .env.prod   # 本番環境設定（コミット不可）
├── package.json
└── tsconfig.json
```

---

## 🔁 週次ワークフロー

```
月曜日
  │  npm run gen:dev -- "第N+1話"
  │    → 今週の制作タスクを Google Tasks にデプロイ
  │    → Google Calendar に連携イベントを作成
  │
月〜日
  │  Google Calendar で作業（ブロックを動かし、メモを書く）
  │
  │  npm run sync:dev  ← いつでも実行して進捗を Tasks に反映
  │
日曜 21:00
  │  投稿完了 ✅
  │
  │  npm run slide:dev -- "第N+2話 ヒント"
  │    → アーカイブ → 昇格 → スケジュール → 次話生成
  ▼
翌月曜日  ← 準備完了
```

---

## 🔄 アンドゥ / リカバリ

最後のシンク操作を取り消すには：

1. 連携しているカレンダーイベントを開く
2. 本文のどこかに `undo` または `戻して` と記入
3. `npm run sync:dev` を実行

Gentask がアンドゥシグナルを検出し、スナップショット（`~/.gentask/snapshots/{taskId}.json`）からタスクを復元して以前の状態に書き戻します。

---

## 🧪 テスト

Gentask は **Vitest** を使用し、ESM および TypeScript に完全対応しています。

```sh
TZ=Asia/Tokyo npm test
```

| ファイル | テスト数 |
|---|---|
| `bin/google.test.ts` | 9 |
| `bin/index.test.ts` | 3 |
| `bin/sync.test.ts` | ~8 |
| `bin/slide.test.ts` | ~18 |
| `lib/env.test.ts` | 3 |
| `lib/snapshot.test.ts` | 7 |
| `lib/types.test.ts` | 12 |
| `src/google.test.ts` | 4 |
| **合計** | **~64** |

---

## 📄 ライセンス

MIT
