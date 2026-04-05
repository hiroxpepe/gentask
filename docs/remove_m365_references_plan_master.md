# docs から M365 記述を削除し、仕様を整合させる（master 実行版）

目的
---
docs 内の Microsoft 365（M365）／Microsoft Graph／Planner／Outlook 等の記述を全てアーカイブまたは削除し、ドキュメント間の仕様齟齬を master ブランチ上で解消する。

前提・安全策
---
- 本作業は master ブランチで直接行う（プロジェクト方針）。
- 元の M365 記述は `docs/legacy/m365_archive.md` に移動して保存する（完全削除は行わない）。
- 変更前に docs のバックアップを作成すること（`docs_backup_YYYYMMDD/`）。

フェーズ分解
---
Phase 0: インベントリとバックアップ（0.5日）
- docs 配下を検索し M365 キーワードを列挙（`rg -n "M365|Microsoft Graph|Planner|Outlook|Azure" docs/`）
- ヒット一覧を Markdown に出力
- docs のバックアップを作成

Phase 1: 分類と方針決定（0.5日）
- 各ヒットを分類: 完全削除 / セクション削除・差替え / 一般化して置換
- 仕様影響度が大きい項目は注記を残す

Phase 2: アーカイブ作業（0.5日）
- 削除対象の M365 固有説明を `docs/legacy/m365_archive.md` に移植
- 移植時に元ファイルと行番号の参照を残す

Phase 3: 実修正（1–2日）
- ファイル単位で master に直接編集・小コミットを繰り返す
- M365 固有部分は Task/Calendar の一般仕様へ置換

Phase 4: 仕様整合・クロスリファレンス更新（0.5日）
- 用語定義・図表・API例を更新して文脈を一致させる
- 目次・内部リンクを更新

Phase 5: 検証・レビュー（0.5–1日）
- 検索で M365 関連語が残っていないことを確認
- コードや運用手順との整合性をレビュー

Phase 6: 完了報告（0.5日）
- master に直接反映した旨をチームに知らせ、`docs/legacy/m365_archive.md` の所在を共有する

コミット方針
---
- ブランチ: master
- コミット: ファイル単位で小さく、英語の短文メッセージを使用する（例: `docs: remove m365 refs from spec_v1.md`）

検証コマンド例
---
- rg -n "M365|Microsoft Graph|Planner|Outlook|Azure" docs/
- rg -i --hidden "M365|Microsoft Graph|Planner|Outlook" || true

ロールバック
---
- `docs/legacy/m365_archive.md` からの復元が可能
- 重大な誤りは git revert で戻す

実行準備が整ったら master 上で編集を開始してください。