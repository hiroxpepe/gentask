# Gentask — 改善タスク一覧

> Gentask をより賢く、堅牢で、摩擦のないツールにするための改善提案。  
> 各タスクは独立して実装可能なスコープに設計されています。テーマ別にグループ化。

---

## テーマ 1: リアルタイムインテリジェンス

---

---

### IMP-03 — AI プロット品質ゲート
**現状:** AI がプロットタスクを生成するが、プロット内容の品質評価は行わない。  
**改善:** スライド処理でプロットタスクを来週分 → 今週分に昇格する前に、Gemini を呼び出してプロット説明をルーブリック（葛藤の明確さ・感情的な弧・ページ数の実現可能性）で採点。閾値未満の場合は昇格をブロックし、理由をユーザーに提示する。  
**主な作業:**
- `slide.ts` に `evaluate_plot(description: string): Promise<{ score: number; feedback: string }>` を追加
- スコアリングルーブリックをプロンプトテンプレートとして定義
- スコアを条件に `promote_next_week` をゲート
- ゲートをバイパスする `--force` フラグを追加

---

---

## テーマ 2: マルチシリーズ & コラボレーション

---

---

## テーマ 3: 可観測性 & 分析

---

### IMP-08 — 過去ベロシティ追跡
**現状:** 各週は独立しており、過去の実績から学習しない。  
**改善:** 毎週のスライド後、タスクタイプごとの実績 sp vs. 見積もり sp を `~/.gentask/velocity.jsonl` に記録。この履歴を使ってタスク見積もりを自動補正。例: プロットが常に 2.0sp の見積もりに対して 2.5sp かかる場合、デフォルト見積もりを更新する。  
**主な作業:**
- `slide.ts` → `archive_current_week()` でベロシティレコードを追記
- `VelocityModel` クラスの構築: タスクタイプごとに直近 N 話の移動平均を計算
- `index.ts` のタスク生成プロンプトで使用する `get_estimate(task_title: string): number` を公開
- サマリーテーブルを出力する `npm run velocity:report` を追加

---

### IMP-09 — 週次メール / LINE 通知
**現状:** プロアクティブな通知が存在しない。  
**改善:** 毎週月曜の朝、先週の達成率・今週のスケジュール負荷・バッファ警告をまとめたダイジェストを送信。メール（SendGrid 経由）と LINE Notify に対応。  
**主な作業:**
- `digest.ts` に `send_weekly_digest(channel: 'email' | 'line', context: WeekContext)` を実装
- テンプレート: 完了率、ロード済み sp、リスクスコア、上位3タスク
- `digest:dev` / `digest:prod` スクリプトを追加
- `SENDGRID_API_KEY` / `LINE_NOTIFY_TOKEN` を env スキーマに追加

---

## テーマ 4: 開発体験

### IMP-10 — インタラクティブ TUI Kanban ボード
**現状:** 全出力がプレーンなコンソールログ。ビジュアルボードが存在しない。  
**改善:** `board` コマンドを追加し、`ink`（CLI 向け React）または `blessed` を使ってライブのターミナル Kanban ボード（今日のタスク・状態・残り sp）を描画。シンク実行時にリアルタイム更新。  
**主な作業:**
- `ink` + `react` 依存を追加
- 列構成: 今週分 | 来週分 | 完了 の `board.tsx` を実装
- タスクモード別に色分け（PTASK=青、TTASK=緑、CTASK=黄、ATASK=グレー）
- `npm run board:dev` スクリプトを追加

---

---

---

---

## テーマ 5: AI 品質

### IMP-14 — 構造化プロンプトテンプレート管理
**現状:** 全 AI プロンプトがコード内のインラインテンプレート文字列。チューニングが困難。  
**改善:** 全 AI プロンプトを YAML フロントマター（モデル・温度・出力スキーマ）付きの Markdown ファイルとして `prompts/` ディレクトリに抽出。ランタイムでロード。コード変更なしにプロンプトのチューニングが可能になる。  
**主な作業:**
- `prompts/task_generation.md`・`prompts/sync_interpretation.md`・`prompts/plot_quality.md` を作成
- `load_prompt(name: string, vars: Record<string, string>): string` ユーティリティを構築
- 全インラインプロンプト文字列を `load_prompt()` 呼び出しに置き換え
- プロンプトのバージョン管理を追加（ファイル名にバージョンを含める: `sync_interpretation_v2.md`）

---

### IMP-15 — マルチモデルフォールバック
**現状:** Gemini 2.0 Flash がハードコードされており、API が利用不可の場合のフォールバックがない。  
**改善:** モデルフォールバックチェーンを追加: Gemini 2.0 Flash → Gemini 1.5 Pro → GPT-4o（OpenAI API 経由）。リトライ可能なエラーでモデル呼び出しが失敗した場合、自動的に次のモデルにフォールバックする。  
**主な作業:**
- `ai_generate(prompt, schema)` を `ModelService` クラスに抽象化
- `.env` の `AI_MODEL_CHAIN=gemini-2.0-flash,gemini-1.5-pro,gpt-4o` でフォールバックチェーンを設定
- GenKit と並行して OpenAI SDK を追加
- 指数バックオフ + モデルローテーションのリトライロジックを実装

---

---

## テーマ 6: インフラ

### IMP-17 — GitHub Actions CI/CD パイプライン
**現状:** テストはローカルでのみ実行される。  
**改善:** すべての push と pull request で `npm test` + `npx tsc --noEmit` を実行する GitHub Actions ワークフローを追加。テスト失敗時はマージをブロック。  
**主な作業:**
- Node.js マトリクス（18.x、20.x）を含む `.github/workflows/ci.yml` を作成
- `actions/cache` で `node_modules` をキャッシュ
- テスト結果レポーター（GitHub アノテーション）を追加
- `README.md` にバッジを追加

---

---

### IMP-19 — 構造化ログ（ログレベル対応）
**現状:** 全出力がフィルタリングなしの `console.log` / `console.error`。  
**改善:** 全コンソール呼び出しをログレベル（`DEBUG`、`INFO`、`WARN`、`ERROR`）をサポートする構造化ロガー（`pino` または `winston`）に置き換え。`LOG_LEVEL` 環境変数で制御。本番環境では JSON 出力、開発環境ではプリティ表示。  
**主な作業:**
- `pino` 依存を追加
- `logger.ts` シングルトンを作成
- 全モジュールの `console.log/warn/error` 呼び出しを置き換え
- `.env.dev` テンプレートに `LOG_LEVEL=debug` を追加

---

### IMP-20 — MS Graph API レート制限 & リトライロジック
**現状:** `graph.ts` はスロットリング（HTTP 429）に対するリトライなしで生の API 呼び出しを行う。  
**改善:** `graph.post/get/patch` を指数バックオフのリトライハンドラーでラップ。MS Graph が 429 レスポンスで返す `Retry-After` ヘッダーを尊重。バースト的なスロットリングを避けるための同時実行数制限を設定可能にする。  
**主な作業:**
- `p-retry` を追加するか `graph.ts` にカスタムリトライロジックを実装
- `Retry-After` ヘッダーをパースしてスリープ
- `GRAPH_MAX_RETRIES` と `GRAPH_CONCURRENCY` 環境変数を追加
- `graph.test.ts` にリトライ動作のテストを追加

---

## 優先度サマリー

| ID | テーマ | 規模 | インパクト |
|---|---|---|---|
| IMP-02 | 締切リスク自動検知 | S | ⭐⭐⭐⭐⭐ |
| IMP-01 | リアルタイム Webhook シンク | L | ⭐⭐⭐⭐⭐ |
| IMP-11 | ドライランモード | S | ⭐⭐⭐⭐ |
| IMP-17 | GitHub Actions CI | S | ⭐⭐⭐⭐ |
| IMP-07 | バーンダウンチャート生成 | M | ⭐⭐⭐⭐ |
| IMP-04 | スマートバッファ自動再配分 | M | ⭐⭐⭐⭐ |
| IMP-05 | マルチシリーズ対応 | M | ⭐⭐⭐ |
| IMP-08 | ベロシティ追跡 | M | ⭐⭐⭐ |
| IMP-10 | TUI Kanban ボード | L | ⭐⭐⭐ |
| IMP-14 | プロンプトテンプレート管理 | S | ⭐⭐⭐ |
| IMP-20 | Graph API レート制限対応 | S | ⭐⭐⭐ |
| IMP-03 | AI プロット品質ゲート | M | ⭐⭐⭐ |
| IMP-19 | 構造化ログ | S | ⭐⭐ |
| IMP-12 | フルバックアップ / リストア | M | ⭐⭐ |
| IMP-06 | アシスタント作家協働 | L | ⭐⭐ |
| IMP-13 | プラグインシステム | L | ⭐⭐ |
| IMP-15 | マルチモデルフォールバック | M | ⭐⭐ |
| IMP-16 | Clip Studio 自動完了検知 | M | ⭐⭐ |
| IMP-09 | 週次メール / LINE 通知 | M | ⭐⭐ |
| IMP-18 | Docker コンテナ | M | ⭐ |

*規模: S = 小（1〜2日）、M = 中（3〜5日）、L = 大（1〜2週間）*
