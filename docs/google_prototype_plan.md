# Google Tasks + Calendar プロトタイプ（MVP）開発フェーズ計画

フェーズ
---
Phase 0 — 準備（1日）
- Google Cloud プロジェクト作成、OAuth クライアント設定
- Google Tasks API、Calendar API を有効化
- `.env.dev` テンプレートに Google のクレデンシャル項目を追加
- 開発用の OAuth 承認手順を docs に記載

Phase 1 — MVP 実装（2–4日）
- OAuth ラッパー実装（ユーザートークン）
- Google Tasks ラッパー: create/update/list/complete
- Google Calendar ラッパー: create/update/list
- タスク⇄イベントの双方向リンク機構（extendedProperties または notes に ID 保存）
- CLI: `gen:google`（タスク＋イベント作成）、`sync:google`（同期）
- dry-run とログ出力の実装

Phase 2 — 同期ルールと UX（1–2日）
- カレンダーの変更を解析してタスク完了/再スケジュールする簡易ルール（例: 本文に「ok」で完了）
- 変更プレビューの表示と衝突回避の基礎実装

Phase 4 — テスト・ドキュメント・整理（1–2日）
- 手動 E2E シナリオと検証手順作成
- docs/setup.md に Google 用の詳細手順を追加
- 必要であれば型チェック・基本テストを CI に追加

検証基準
---
- `npm run gen:google -- "タイトル"` で Google Tasks にタスク作成、対応イベントがカレンダーに作成される
- イベントに「ok」を書き保存し `npm run sync:google` 実行でタスクが完了する
- 主要ユースケースを 3 回再現して問題がないこと

配布物
---
- 実働する CLI: `gen:google`, `sync:google`（MVP）
- docs/setup.md の Google 用手順
- 簡易メタデータ保存の実装 (`~/.gentask/metadata.json`)

次のアクション
---
- Phase 0 の OAuth 手順を作成して欲しい場合は「OAuth を作る」と指示してください。
- そのまま実装を開始する場合は「実装開始」と指示してください。
