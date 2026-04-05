# M365 Archive
## Archive run: 20260405_121342
\n### File: docs/google_prototype_plan.md\n
----
目的
---
既存の M365 連携を保留し、Google Tasks と Google Calendar を用いて最小機能で動作するプロトタイプを短期間で作成し、主要ユースケースの検証と将来の移行方針を決定する。

----
Phase 3 — メタデータ層（2–3日）
- Planner のバケット/担当/進捗を補完する軽量メタデータ実装（まずは `~/.gentask/metadata.json`）
- 将来的な Firestore への移行設計（マッピング定義）

\n### File: docs/improvement-tasks.md\n
----
### IMP-01 — MS Graph Webhook Subscriptions (Real-Time Sync)
**Current state:** `sync` is a manual command; user must run it explicitly.  
**Improvement:** Subscribe to MS Graph change notifications for the user's Outlook calendar. When an event is created or modified, automatically trigger the AI sync pipeline without any user action.  
**Impact:** The core "management that doesn't feel like management" promise becomes fully passive.  
**Key work:**
- Implement `POST /subscriptions` to register webhook on `/me/events`
- Add a lightweight HTTP listener (`express` or Hono) to receive change notifications
- Debounce rapid-fire events (e.g., user dragging blocks) before triggering AI
- Handle subscription renewal (subscriptions expire after 4230 minutes)

----
### IMP-02 — Proactive Deadline Risk Detection
**Current state:** Gentask records progress but never warns the user.  
**Improvement:** After every sync, calculate remaining sp vs. available time to Sunday 21:00. If the burn rate predicts a miss, automatically push an Outlook event titled `⚠️ DEADLINE RISK` with a breakdown, and raise the priority of at-risk Planner tasks.  
**Key work:**
- Build a `risk_calculator` module: `remaining_sp / available_hours → risk_score`
- Define thresholds: `≥ 0.9` = critical, `≥ 0.7` = warning
- Create Outlook event via Graph API when threshold is breached
- Add unit tests

----
### IMP-04 — Smart Buffer Auto-Reallocation
**Current state:** Buffer tasks are consumed manually via the `buffer_consumed` sync action.  
**Improvement:** When the AI detects that a task has overrun its estimated sp, automatically recalculate remaining buffer and reallocate blocks in the Outlook calendar — pushing or shrinking other slots to absorb the overrun, respecting the Sunday 21:00 hard deadline.  
**Key work:**
- Build `rebalance_schedule(overrun_sp: number, context: WeekContext)` in `slide.ts`
- Implement slot-packing algorithm: fill from latest available slot backwards
- Update both Planner due dates and Outlook event times
- Log the rebalanced plan for user review

----
### IMP-05 — Multi-Series Support
**Current state:** Gentask is hardcoded to a single series (one set of Planner group IDs).  
**Improvement:** Support multiple concurrent manga series, each with its own Planner group set, Outlook calendar, and 18sp model configuration. A `--series` flag selects the active series.  
**Key work:**
- Replace flat env vars with a `~/.gentask/config.json` that maps series names to group ID sets
- Add `series` management commands: `gentask series add <name>`, `gentask series list`
- Update all modules to accept a `SeriesContext` instead of reading global env
- Implement series-aware snapshot namespacing

----
### IMP-06 — Multi-User Collaboration (Assistant Artist Support)
**Current state:** Gentask is single-user.  
**Improvement:** Allow an assistant artist to be assigned specific tasks (e.g., 3D Modeling, Background Layout). Assigned tasks are deployed to the assistant's Planner and Outlook, and their completions feed back into the main series sync.  
**Key work:**
- Add `assignee_id?: string` field to `task_schema`
- Route task creation to the correct user's Planner via `POST /users/{id}/planner/tasks`
- Aggregate sync inputs from multiple users' calendars in `build_sync_inputs()`
- Handle conflict resolution when both users update the same logical task

----
### IMP-07 — Weekly Burndown Chart Generation
**Current state:** No visual reporting.  
**Improvement:** After each sync, generate a burndown chart (remaining sp vs. elapsed days) as a PNG file saved to `~/.gentask/reports/{YYYY-WW}.png`. Optionally embed the chart as a card in a designated Planner task for easy access.  
**Key work:**
- Add `chartjs-node-canvas` or `vega-lite` dependency for server-side chart rendering
- Track daily sp snapshots in `~/.gentask/history/{YYYY-WW}.jsonl`
- Implement `generate_burndown_chart(week_data)` in a new `report.ts` module
- Add `npm run report:dev` script

----
### IMP-11 — Dry-Run Mode for All Commands
**Current state:** `gen`, `sync`, and `slide` execute immediately with no preview.  
**Improvement:** Add a `--dry-run` flag to all commands. In dry-run mode, show exactly what API calls would be made (PATCH urls + bodies) without executing them. Essential for production safety.  
**Key work:**
- Add `dry_run: boolean` option to `GraphService`, `PlannerService`, `PlannerSyncService`, `SlideService`
- In dry-run mode, print a colored diff of proposed changes instead of making API calls
- Add `--dry-run` to CLI arg parsing in all entry points

----
### IMP-12 — Full State Export / Import (Backup & Restore)
**Current state:** Snapshots cover individual task states, but there is no full-state export.  
**Improvement:** Add `gentask export` to dump all Planner plans, buckets, tasks, and Outlook events to a single JSON archive. Add `gentask import` to restore from that archive (e.g., after a tenant migration or accidental deletion).  
**Key work:**
- Build `backup.ts`: traverse all plans → buckets → tasks → events → write `~/.gentask/backup-{timestamp}.json`
- Build `restore.ts`: replay the JSON archive via POST/PATCH calls with idempotency checks
- Handle etag conflicts during restore
- Add `npm run backup:dev` / `npm run restore:dev` scripts

----
### IMP-13 — Plugin / Custom Action System
**Current state:** Sync actions are hardcoded (`complete`, `reschedule`, etc.).  
**Improvement:** Allow users to register custom sync action handlers via a plugin file at `~/.gentask/plugins.ts`. For example: "if note contains '入稿済み', mark the linked Outlook event as Done and send a LINE message."  
**Key work:**
- Define `SyncPlugin` interface: `{ pattern: RegExp; handler: (task, context) => Promise<void> }`
- Load plugins from `~/.gentask/plugins.ts` at startup via dynamic `import()`
- Run custom plugins after built-in action processing
- Document the plugin API with examples

----
### IMP-16 — Clip Studio Paint Auto-Completion Detection
**Current state:** Task completion requires manual Outlook notes or sync commands.  
**Improvement:** Watch a configurable `~/Documents/ClipStudio/` directory for `.clip` file save events. When a file matching a task title pattern is saved, automatically mark the corresponding Planner task as complete and update Outlook.  
**Key work:**
- Add `chokidar` for cross-platform file watching
- Build `studio_watcher.ts`: map filename patterns → task titles (configurable in `~/.gentask/config.json`)
- Run as a background daemon: `npm run studio:watch`
- Debounce rapid saves (only trigger after 5s of inactivity)

----
### IMP-18 — Docker Container + One-Command Setup
**Current state:** Setup requires installing Node, Azure CLI, and configuring env manually.  
**Improvement:** Provide a `Dockerfile` and `docker-compose.yml` that pre-installs all dependencies. Users only need to mount their `.env.dev` file and run `docker compose run gentask gen:dev -- "Episode N"`.  
**Key work:**
- Write multi-stage `Dockerfile` (build stage + runtime stage with Azure CLI)
- Write `docker-compose.yml` with volume mounts for `.env.*` and `~/.gentask/`
- Add `DOCKER_SETUP.md` with step-by-step instructions
- Test on macOS and Linux

\n### File: docs/improvement-tasks_jp.md\n
----
### IMP-01 — MS Graph Webhook サブスクリプション（リアルタイムシンク）
**現状:** `sync` はマニュアルコマンド。ユーザーが明示的に実行する必要がある。  
**改善:** ユーザーの Outlook カレンダーに対して MS Graph の変更通知（Webhook）を購読。イベントが作成・変更された瞬間に、ユーザーの操作なしで AI シンクパイプラインを自動起動する。  
**効果:** 「管理を意識させない管理」という設計思想が完全に受動的な形で実現される。  
**主な作業:**
- `POST /subscriptions` で `/me/events` への Webhook を登録
- 変更通知を受け取る軽量 HTTP リスナー（`express` または Hono）を追加
- ユーザーがブロックを連続移動する際の急速なイベントをデバウンス処理
- サブスクリプション更新対応（4230分で期限切れ）

----
### IMP-02 — 締切リスク自動検知
**現状:** Gentask は進捗を記録するが、ユーザーへの警告を一切行わない。  
**改善:** 毎回のシンク後に「残り sp ÷ 日曜 21:00 までの残り時間」を計算。消化ペースが締切ミスを示す場合、`⚠️ 締切リスク` というタイトルの Outlook イベントを自動作成し、リスクのある Planner タスクの優先度を引き上げる。  
**主な作業:**
- `risk_calculator` モジュールの実装: `残り sp / 残り時間 → risk_score`
- 閾値定義: `≥ 0.9` = 危機的、`≥ 0.7` = 警告
- 閾値超過時に Graph API 経由で Outlook イベントを作成
- ユニットテストを追加

----
### IMP-04 — スマートバッファ自動再配分
**現状:** バッファタスクは `buffer_consumed` シンクアクションで手動消費する。  
**改善:** AI がタスクの見積もり sp 超過を検知した際、残りバッファを自動計算し直し、Outlook カレンダーのブロックを再配分。超過分を吸収しながら日曜 21:00 の絶対デッドラインを遵守する。  
**主な作業:**
- `slide.ts` に `rebalance_schedule(overrun_sp: number, context: WeekContext)` を実装
- スロットパッキングアルゴリズム: 最遅スロットから逆向きに充填
- Planner の期限と Outlook イベント時刻を両方更新
- 再配分プランをユーザーレビュー用にログ出力

----
### IMP-05 — マルチシリーズ対応
**現状:** Planner グループ ID が単一シリーズにハードコードされている。  
**改善:** 複数の連載を同時管理できるよう対応。各シリーズは独自の Planner グループセット・Outlook カレンダー・18sp モデル設定を持つ。`--series` フラグでアクティブなシリーズを選択。  
**主な作業:**
- 環境変数からシリーズ名 → グループ ID セットのマッピングを持つ `~/.gentask/config.json` に移行
- `gentask series add <name>`、`gentask series list` コマンドを追加
- 全モジュールがグローバル env の代わりに `SeriesContext` を受け取るよう変更
- シリーズを考慮したスナップショットの名前空間管理

----
### IMP-06 — マルチユーザー協働（アシスタント作家サポート）
**現状:** Gentask はシングルユーザー専用。  
**改善:** アシスタント作家に特定タスク（例: 3Dモデル制作・背景レイアウト）をアサインできるよう対応。アサインされたタスクはアシスタントの Planner と Outlook にデプロイされ、完了がメインのシリーズシンクにフィードバックされる。  
**主な作業:**
- `task_schema` に `assignee_id?: string` フィールドを追加
- `POST /users/{id}/planner/tasks` 経由で適切なユーザーの Planner にタスクをルーティング
- `build_sync_inputs()` で複数ユーザーのカレンダーからシンク入力を集約
- 両ユーザーが同一の論理タスクを更新した場合のコンフリクト解消処理

----
### IMP-07 — 週次バーンダウンチャート生成
**現状:** ビジュアルレポーティングが存在しない。  
**改善:** 各シンク後に残り sp と経過日数のバーンダウンチャートを PNG として `~/.gentask/reports/{YYYY-WW}.png` に生成。オプションで、指定した Planner タスクのカードとして埋め込む。  
**主な作業:**
- サーバーサイドチャートレンダリング用に `chartjs-node-canvas` または `vega-lite` を追加
- 日次 sp スナップショットを `~/.gentask/history/{YYYY-WW}.jsonl` に記録
- 新しい `report.ts` モジュールに `generate_burndown_chart(week_data)` を実装
- `npm run report:dev` スクリプトを追加

----
### IMP-11 — 全コマンドへのドライランモード追加
**現状:** `gen`・`sync`・`slide` は確認なしで即実行される。  
**改善:** 全コマンドに `--dry-run` フラグを追加。ドライランモードでは、実際に API を呼び出さず、行われるはずの API 呼び出し（PATCH URL + ボディ）をすべて表示する。本番運用の安全性に必須。  
**主な作業:**
- `GraphService`・`PlannerService`・`PlannerSyncService`・`SlideService` に `dry_run: boolean` オプションを追加
- ドライランモードでは API 呼び出しの代わりに変更差分をカラーで表示
- 全エントリポイントの CLI 引数パースに `--dry-run` を追加

----
### IMP-12 — 全状態エクスポート / インポート（バックアップ & リストア）
**現状:** スナップショットは個別タスクの状態を保存するが、全状態エクスポートは存在しない。  
**改善:** `gentask export` コマンドで全 Planner プラン・バケット・タスク・Outlook イベントを単一の JSON アーカイブにダンプ。`gentask import` でそのアーカイブから復元（テナント移行や誤削除後の復旧など）。  
**主な作業:**
- `backup.ts` の実装: 全プラン → バケット → タスク → イベントを走査して `~/.gentask/backup-{timestamp}.json` に書き出し
- `restore.ts` の実装: JSON アーカイブを冪等性チェック付きで POST/PATCH 再生
- リストア時の etag コンフリクト処理
- `npm run backup:dev` / `npm run restore:dev` スクリプトを追加

----
### IMP-13 — プラグイン / カスタムアクションシステム
**現状:** シンクアクションは `complete`・`reschedule` 等にハードコードされている。  
**改善:** `~/.gentask/plugins.ts` のプラグインファイルを通じてカスタムシンクアクションハンドラーを登録できるようにする。例: 「メモに '入稿済み' が含まれる場合、連携 Outlook イベントを完了にして LINE メッセージを送る」  
**主な作業:**
- `SyncPlugin` インターフェースを定義: `{ pattern: RegExp; handler: (task, context) => Promise<void> }`
- 動的 `import()` で起動時に `~/.gentask/plugins.ts` からプラグインをロード
- 組み込みアクション処理の後にカスタムプラグインを実行
- サンプル付きでプラグイン API をドキュメント化

----
### IMP-16 — Clip Studio Paint 自動完了検知
**現状:** タスク完了には Outlook への手動メモ記入またはシンクコマンド実行が必要。  
**改善:** 設定可能な `~/Documents/ClipStudio/` ディレクトリの `.clip` ファイル保存イベントを監視。タスクタイトルのパターンに一致するファイルが保存されると、対応する Planner タスクを自動完了して Outlook を更新する。  
**主な作業:**
- クロスプラットフォームのファイル監視に `chokidar` を追加
- `studio_watcher.ts` の構築: ファイル名パターン → タスクタイトルのマッピング（`~/.gentask/config.json` で設定可能）
- バックグラウンドデーモンとして実行: `npm run studio:watch`
- 高速連続保存のデバウンス処理（5秒間の非活動後にのみ発火）

----
### IMP-18 — Docker コンテナ + ワンコマンドセットアップ
**現状:** セットアップには Node・Azure CLI のインストールと env の手動設定が必要。  
**改善:** 全依存関係がプリインストールされた `Dockerfile` と `docker-compose.yml` を提供。ユーザーは `.env.dev` ファイルをマウントして `docker compose run gentask gen:dev -- "第N話"` を実行するだけ。  
**主な作業:**
- マルチステージ `Dockerfile`（ビルドステージ + Azure CLI 付きランタイムステージ）を作成
- `.env.*` と `~/.gentask/` のボリュームマウント付き `docker-compose.yml` を作成
- ステップバイステップの手順を含む `DOCKER_SETUP.md` を追加
- macOS と Linux でテスト

\n### File: docs/master_branch_policy.md\n
----
目的
---
本プロジェクトにおけるドキュメント（docs）関連の編集作業はすべて master ブランチで直接実施する。M365 関連の記述を排除し、仕様の整合性を master 上で即時に反映するための運用ルールを定義する。

----
基本方針
---
- すべての docs 修正は master ブランチで実施する（ブランチは作らない）。
- 変更は小さな単位（原則ファイル単位）でコミットする。コミットメッセージは英語の短文にする（例: `docs: remove m365 references from spec_v1.md`）。
- 元の M365 記述は `docs/legacy/m365_archive.md` にまとめてアーカイブし、公開ドキュメントからは除外する。
- 重要な変更は事前に docs のバックアップを取り、変更後に全文検索で残存語のチェックを行う（例: `rg -i "M365|Microsoft Graph|Planner|Outlook" docs/`）。

----
運用手順（短縮）
---
1. docs のバックアップ（`docs_backup_YYYYMMDD/`）を作成する。
2. M365 に関する記述を検索して一覧化する。
3. アーカイブ対象を `docs/legacy/m365_archive.md` に移植する。
4. ファイル単位で編集・コミット・push を行う。
5. 編集完了後に残存チェックを実行し、問題なければ完了とする。

\n### File: docs/phase1.md\n
----
承知いたしました。これまでの設計思想、型定義、そしてエレガントな実装構造をすべて統合した **`phase1.md`** の決定版を「生マークダウン」でまとめます。
# Phase 1: GenTask 構築と M365 Planner 連携の実装

----
本フェーズでは、GenKit による AI 思考エンジンと Microsoft 365 Planner を物理的に接続し、AI が生成したタスクを動的に P/T/C/A 分類してデプロイする基盤を構築します。

----
```text
gentask/
├── .env.dev            # 開発環境設定
├── .env.prod           # 本番環境設定
├── package.json        # プロジェクト構成
├── graph.ts            # 通信基盤 (az rest wrapper)
├── planner.ts          # Planner 構築サービス
└── index.ts            # GenKit Flow & エントリポイント
```

----
/**
 * @namespace graph
 * @description Microsoft Graph API に対する低レベル通信を担うオブジェクト。
 * Azure CLI (az rest) をラッパーとして使用し、認証管理を CLI 側に委任する。
 */
export const graph = {
    /**
     * @function post
     * @description 指定された URL に対して POST リクエストを送信する。
     * @param {string} url - リクエスト先の Graph API エンドポイント URL
     * @param {object} body - 送信する JSON ペイロードデータ
     * @returns {any} API から返却された JSON レスポンス
     */
    post: (url: string, body: object): any => {
        // オブジェクトを文字列化し、標準入力経由で az rest に渡す
        const payload = JSON.stringify(body);
        // --body @- は標準入力からデータを読み込む指定。エスケープ問題を回避する最も安全な方法。
        const cmd = `az rest --method post --url "${url}" --body @-`;

----
## 3. プランナー・サービスの実装 (`planner.ts`)

----
/**
 * @class PlannerService
 * @description Microsoft 365 Planner 上にタスク構造を構築するサービス。
 * P/T/C/A モードごとにプランを 1 つに集約し、日次タイムスタンプで管理する。
 */
export class PlannerService {
    /** @private {string|undefined} m365_user_id - タスク割り当てに使用する実行ユーザーの ID */
    private m365_user_id = process.env.M365_USER_ID;

----
    /** @private {Record} label_map - スキーマのラベル名から Planner API のカテゴリ番号へのマッピング表 */
    private label_map: Record<string, string> = {
        'Pink': 'category1', 'Red': 'category2', 'Yellow': 'category3',
        'Green': 'category4', 'Blue': 'category5', 'Purple': 'category6'
    };

----
    /**
     * @method execute_deployment
     * @description AI が生成した複数のタスクをループし、適切な Planner プランへ配置する。
     * @param {gen_task[]} tasks - 展開対象となるタスクオブジェクトの配列
     * @returns {Promise<void>}
     */
    async execute_deployment(tasks: gen_task[]): Promise<void> {
        for (const task of tasks) {
            // 当該モード（P/T/C/A）に対応するプランとバケットを取得（なければ作成）
            const { plan_id, bucket_id } = await this.ensure_container(task.mode);

----
            // タスクの物理作成
            await graph.post(`https://graph.microsoft.com/v1.0/planner/tasks`, {
                planId: plan_id,
                bucketId: bucket_id,
                title: task.title,
                priority: task.priority,
                // 実行ユーザーにタスクを自動割り当て
                assignments: {
                    [this.m365_user_id!]: {
                        "@odata.type": "#microsoft.graph.plannerAssignment",
                        "orderHint": " !"
                    }
                },
                // スキーマで指定されたカラーラベルを適用
                appliedCategories: { [this.label_map[task.label]]: true }
            });
        }
    }

----
        const group_id = process.env[`M365_PLANNER_${mode}_GROUP_ID`];
        // 指定された命名規則 {MODE}_{YYYYMMDD}_{HHMM} を適用
        const plan_title = `${mode}_${this.current_timestamp}`;

----
        // 1. 指定グループ内にプランを作成
        const plan_res = await graph.post(`https://graph.microsoft.com/v1.0/planner/plans`, {
            title: plan_title,
            container: {
                url: `https://graph.microsoft.com/v1.0/groups/${group_id}`,
                "@odata.type": "#microsoft.graph.plannerPlanContainer"
            }
        });

----
        // 2. 作成したプランの中に "To Do" バケットを作成
        const bucket_res = await graph.post(`https://graph.microsoft.com/v1.0/planner/buckets`, {
            name: "To Do",
            planId: plan_res.id
        });

----
```ts
import { genkit, z } from 'genkit';
import { googleAI, gemini20Flash } from '@genkit-ai/googleai';
import * as dotenv from 'dotenv';
import { PlannerService } from './planner';

----
    priority: z.number().min(1).max(9).default(5)
        .describe('Planner API 優先度。1:最優先（緊急）, 3:重要, 5:普通, 9:低。'),

----
        // 2. Planner サービスを使用して M365 へ展開
        const service_instance = new PlannerService();
        await service_instance.execute_deployment(generated_tasks);

----
# 1. 指定した日時に一致するプラン（PTASK_, TTASK_, CTASK_, ATASK_）を抽出
echo "🔍 Searching for plans from: $TARGET_DATETIME ..."
PLANS=$(az rest --method get \
  --url "https://graph.microsoft.com/v1.0/groups/$M365_PLANNER_PTASK_GROUP_ID/planner/plans" \
  --query "value[?contains(title, '$TARGET_DATETIME')].{id:id, title:title, etag:\"@odata.etag\"}" -o json)

----
  echo "🗑️ Deleting: $PLAN_TITLE ..."
  
  az rest --method delete \
    --url "https://graph.microsoft.com/v1.0/planner/plans/$PLAN_ID" \
    --header "If-Match=$PLAN_ETAG"
done

\n### File: docs/plan_v1.md\n
----
| ファイル | 役割 | 状態 |
|---|---|---|
| `index.ts` | GenKit Flow + CLI エントリポイント | ✅ 動作 |
| `graph.ts` | `az rest` ラッパー（POST のみ） | ⚠️ 不完全 |
| `planner.ts` | Planner プラン/バケット/タスク作成 | ⚠️ 問題あり |
| `.env.dev` | 開発環境設定（実 ID 入り） | ⚠️ 要注意 |
| `.env.prod` | 本番環境設定（実シークレット入り） | ⚠️ 要注意 |

----
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

----
- Outlook ↔ Planner AI シンクロナイザー
- Open Extensions による永続的 ID 紐付け
- スナップショット + Undo/リカバリ機能
- 日曜 21:00 自動スライド（昇格）プロセス
- 18.0sp / 36-Block ライフサイクル管理全般

----
#### B-1: `description` フィールドがデプロイされていない
- `task_schema` に `description` を定義し AI に生成させているが、`planner.ts` の `graph.post` 呼び出しにこのフィールドが含まれていない。
- AI が生成した詳細説明がすべて無視されている。

----
#### B-2: 循環参照 (`planner.ts` ↔ `index.ts`)
- `planner.ts` が `import { gen_task } from './index'` している。
- `index.ts` が `import { PlannerService } from './planner'` している。
- 型定義（`gen_task`, `task_schema`）は独立したファイルに切り出すべき。

----
#### D-1: `graph.ts` に GET / PATCH / DELETE がない
- 現状は POST のみ。
- Phase 2 の Outlook 読み取り・タスク更新・Undo には GET と PATCH が必須。

----
#### D-2: 環境変数のバリデーションがない
- `M365_USER_ID` が未定義の場合、`this.m365_user_id!` は実行時クラッシュ。
- `M365_PLANNER_${mode}_GROUP_ID` が未定義の場合も同様。
- 起動時に必須変数の存在チェックが必要。

----
#### S-1: `.env` ファイルに本物のシークレットが含まれている
- `.env.dev` / `.env.prod` は `.gitignore` で除外済み（✅ 正しい）。
- ただし `M365_CLIENT_SECRET`、`GCP_VERTEX_AI_API_KEY` 等の実値がディスク上に平文で存在する。
- ローカル実行環境の破棄・クラウド環境への移行時に Secret Manager 等への移行を検討すること。

----
| # | タスク | 概要 | 優先度 |
|---|---|---|---|
| T-01 | 型定義の独立ファイル化 | `gen_task`, `task_schema` を `types.ts` に切り出し循環参照を解消 | 🔴 高 |
| T-02 | `description` のデプロイ対応 | `planner.ts` で `taskDetail` を使い `description` を Planner に書き込む | 🔴 高 |
| T-03 | `graph.ts` の非同期化 | `execSync` → `spawnAsync` または `fetch` + `az account get-access-token` へ変更 | 🟡 中 |
| T-04 | `graph.ts` に GET / PATCH 追加 | Phase 2 実装の前提となる通信レイヤーを整備 | 🟡 中 |
| T-05 | 環境変数バリデーション | 起動時に必須変数を一括チェックし、欠損があれば明確なエラーで終了 | 🟡 中 |
| T-06 | `tsconfig.json` の追加 | `strict: true` で型安全性を担保 | 🟢 低 |

----
| # | タスク | 概要 | 優先度 |
|---|---|---|---|
| T-07 | Open Extensions の実装 | Outlook Event ↔ Planner Task の永続 ID 紐付け | 🔴 高 |
| T-08 | Outlook カレンダー読み取り | Graph API で予定一覧を取得するサービス実装 | 🔴 高 |
| T-09 | AI 進捗判定フロー | Outlook の更新内容を GenKit で解析し Planner に反映する Flow | 🔴 高 |
| T-10 | Planner タスク更新 | PATCH で status / dueDate / assignments を書き換えるメソッド追加 | 🟡 中 |

----
| # | タスク | 概要 | 優先度 |
|---|---|---|---|
| T-11 | スナップショットエンジン | API 操作前の状態を JSON でローカル保存する仕組み | 🟡 中 |
| T-12 | Undo トリガー検知 | Outlook 予定の本文に「undo」が書かれた場合にリストア実行 | 🟡 中 |
| T-13 | 日曜 21:00 自動スライド | cron または Cloud Scheduler で週次昇格プロセスを自動実行 | 🟢 低 |

----
| # | タスク | 概要 | 優先度 |
|---|---|---|---|
| T-14 | Secret Manager への移行 | GCP Secret Manager / Azure Key Vault でシークレット管理 | 🟡 中 |
| T-15 | Cloud Run / Functions 化 | ローカル CLI から常駐サービスへの移行 | 🟢 低 |
| T-16 | テスト基盤の整備 | Vitest でユニットテスト追加（Flow・PlannerService・graph） | 🟢 低 |

----
Phase 1 の「AI でタスクを生成して Planner に投げる」基盤は動いている。  
次のステップとして **T-01〜T-06 の負債解消**を先に行い、その上で **Phase 2 の双方向シンク**に進むのが最も安全なルートと判断する。

----
> 「人間が自由に動いた結果を、AI が解釈してシステムを合わせる」（spec_v1.md より）  
> この哲学を実現するには、Phase 2 の Outlook 読み取りと AI 判定フローが核心となる。
\n### File: docs/plan_v2.md\n
----
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

----
> **「AI がシステムを合わせる」の第一歩**
> Gentask がタスクを Planner に作るだけでなく、同時に Outlook カレンダーにも予定を配置し、
> ユーザーが予定に書いたメモを AI が解釈して Planner を自動更新する。

----
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

----
■ 同期時（npm run sync:dev）
  sync.ts
    ├─ OutlookService.get_linked_events() → 紐付き予定を全取得
    ├─ sync_flow（GenKit AI）→ 本文変化を解釈 → sync_action[] 出力
    └─ PlannerSyncService.apply_actions() → Planner に PATCH
```

----
```ts
// Outlook イベントの必要最小構造
outlook_event = {
    id, subject, body.content,
    start.dateTime, end.dateTime,
    extensions: [{ plannerTaskId?: string }]
}

----
// AI の判定結果
sync_action = {
    plannerTaskId: string,
    action: 'complete' | 'reschedule' | 'add_note' | 'buffer_consumed' | 'no_change',
    note?: string,
    newDueDate?: string   // ISO 8601
}
```

----
| # | タスク | ファイル | 依存 |
|---|---|---|---|
| T-08 | OutlookService 実装 | `outlook.ts` (新規) | — |
| T-07 | Open Extensions 実装 | `planner.ts` 更新 + `outlook.ts` | T-08 |
| T-09 | AI 進捗判定フロー | `sync.ts` (新規) | T-07 |
| T-10 | sync コマンド追加 | `package.json` 更新 | T-09 |

----
### T-08: outlook.ts

----
```
OutlookService
  create_event(task, planner_task_id, start_iso, end_iso)
    → POST /me/events
    → 戻り値: outlook event id

----
  add_extension(event_id, planner_task_id)
    → POST /me/events/{id}/extensions
    → extensionName: "com.gentask.v1"

----
### T-07: planner.ts 更新

----
```
execute_deployment() に追加:
  1. Planner タスク作成（既存）
  2. description PATCH（既存）
  3. Outlook イベント作成（T-08）
  4. Outlook イベントに extension 追加（plannerTaskId）
  5. Planner タスクに extension 追加（outlookEventId）
```

----
```
sync_flow (GenKit Flow)
  input: { subject, body, existingStatus }[]
  output: sync_action[]
  prompt: "以下の予定変化を解析し、Planner の更新指示を出力せよ..."

----
# 2. タスク生成（Outlook 予定も同時作成されることを確認）
npm run gen:dev -- "週刊連載 第100話の制作"
# → Planner にタスクが並ぶ
# → Outlook カレンダーに予定が並ぶ
# → 双方に extension が付いていることを確認

----
# 3. Outlook 予定の本文に "ok" と書いて保存

----
# 4. 同期実行
npm run sync:dev
# → 該当 Planner タスクの percentComplete が 100 になっていることを確認
```
\n### File: docs/plan_v3.md\n
----
```
コミット:
c8ae856  feat: Phase 2 — Outlook sync, Open Extensions, AI progress interpretation
e9fd7f2  refactor: Phase 1.5 — fix circular deps, async graph, description deploy
991f541  docs: Create structured README with project philosophy

----
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

----
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

----
**現在の実装（planner.ts `ensure_container`）:**
```
Plan: PTASK_20260330_1430
  └── Bucket: "To Do"  ← 1種類のみ
```

----
| # | タスク | ファイル | 概要 |
|---|---|---|---|
| **T-B1** | バケット構造を3構成に変更 | `planner.ts` | `ensure_container` を「今週分/来週分/完了」の3バケット構成に修正。新規タスクは mode に応じて「今週分」か「来週分」に振り分ける |
| **T-B2** | types.ts に bucket_role 追加 | `types.ts` | `'current' \| 'next' \| 'done'` の bucket_role 型を追加。gen_task に `bucket?: bucket_role` を追加 |

----
| # | タスク | ファイル | 概要 |
|---|---|---|---|
| **T-15** | slide.ts — 投稿完了チェック＋アーカイブ | `slide.ts` (新規) | 「投稿」タスクの `percentComplete === 100` を確認。今週分バケットの全タスクを完了バケットへ移動（`bucketId` PATCH） |
| **T-16** | slide.ts — 来週分企画タスクの昇格 | `slide.ts` | 来週分バケットの PTASK（プロット・ネーム）を取得し、`bucketId` を今週分に変更 + `startDateTime` を翌月曜に更新 |
| **T-17** | slide.ts — Outlook カレンダー自動配置 | `slide.ts` | 昇格したタスクを spec §3 の週間スケジュール表に従い翌月〜金に Outlook 予定を自動作成（OutlookService 再利用） |
| **T-18** | slide.ts — 次々回話数プロット生成＋コマンド追加 | `slide.ts` + `package.json` | 空いた来週分バケットに task_flow で次々回話数のプロットタスク4ブロックを生成。`slide:dev` / `slide:prod` コマンド追加 |

----
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

----
# 2. デプロイ（3バケット構成になっているか確認）
npm run gen:dev -- "第101話の制作"
# → Planner に「今週分」「来週分」「完了」バケットが3つ生成される

----
# 5. スライド実行
npm run slide:dev
# → 今週分アーカイブ → 来週分昇格 → Outlook 配置 → 次週プロット生成
```

\n### File: docs/remove_m365_ref_plan.md\n
----
# docs から M365 記述を削除し、仕様を整合させる（master 実行版）

----
目的
---
docs 内の Microsoft 365（M365）／Microsoft Graph／Planner／Outlook 等の記述を全てアーカイブまたは削除し、ドキュメント間の仕様齟齬を master ブランチ上で解消する。

----
前提・安全策
---
- 本作業は master ブランチで直接行う（プロジェクト方針）。
- 元の M365 記述は `docs/legacy/m365_archive.md` に移動して保存する（完全削除は行わない）。
- 変更前に docs のバックアップを作成すること（`docs_backup_YYYYMMDD/`）。

----
フェーズ分解
---
Phase 0: インベントリとバックアップ（0.5日）
- docs 配下を検索し M365 キーワードを列挙（`rg -n "M365|Microsoft Graph|Planner|Outlook|Azure" docs/`）
- ヒット一覧を Markdown に出力
- docs のバックアップを作成

----
Phase 2: アーカイブ作業（0.5日）
- 削除対象の M365 固有説明を `docs/legacy/m365_archive.md` に移植
- 移植時に元ファイルと行番号の参照を残す

----
Phase 3: 実修正（1–2日）
- ファイル単位で master に直接編集・小コミットを繰り返す
- M365 固有部分は Task/Calendar の一般仕様へ置換

----
Phase 5: 検証・レビュー（0.5–1日）
- 検索で M365 関連語が残っていないことを確認
- コードや運用手順との整合性をレビュー

----
Phase 6: 完了報告（0.5日）
- master に直接反映した旨をチームに知らせ、`docs/legacy/m365_archive.md` の所在を共有する

----
コミット方針
---
- ブランチ: master
- コミット: ファイル単位で小さく、英語の短文メッセージを使用する（例: `docs: remove m365 refs from spec_v1.md`）

----
検証コマンド例
---
- rg -n "M365|Microsoft Graph|Planner|Outlook|Azure" docs/
- rg -i --hidden "M365|Microsoft Graph|Planner|Outlook" || true

----
ロールバック
---
- `docs/legacy/m365_archive.md` からの復元が可能
- 重大な誤りは git revert で戻す

\n### File: docs/script-classification.md\n
----
-   **`index.ts`**: タスク生成 (`npm run gen`) のエントリーポイント。AIにタスクを分解させ、Plannerへ展開するメイン処理。
-   **`slide.ts`**: 週次処理 (`npm run slide`) のエントリーポイント。週の切り替え時に、タスクのアーカイブや来週分の昇格などを行う。
-   **`sync.ts`**: 同期処理 (`npm run sync`) のエントリーポイント。Outlookカレンダーの変更を検知し、Plannerタスクの進捗に反映させる。

----
-   **`types.ts`**: プロジェクト全体で使われる型定義（`task_schema`など）。
-   **`env.ts`**: 必須環境変数が設定されているかチェックする検証ツール。
-   **`graph.ts`**: Microsoft Graph APIと通信するための低レベルな共通関数。
-   **`snapshot.ts`**: タスクの変更前状態を保存・復元するためのスナップショット機能。
-   **`outlook.ts`**: Outlookカレンダーの予定作成や取得に特化したサービスクラス。

----
-   **`planner.ts`**: AIが生成した抽象的なタスクを、M365 Planner上の具体的なプラン・バケット・タスクへと変換・配置する詳細なロジックを担う。
