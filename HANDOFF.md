# HANDOFF.md

> 新チャット開始時は、このファイルと `docs/new_spec_gentask_JP.md` を最初に読む。

## 🧭 現在地と次の一手（最優先で読め）

### 現在地
**設計は「フェーズ1（共通骨格）が実装できる水準」まで揃った。実装コードはまだ 0 行。**
- 概念（第5章）・ER共通骨格・コマンドリファレンス・コマンド詳細仕様まで整合済み・push 済み。
- ドキュメント体系：
  - `docs/new_spec_gentask_JP.md`（正本・概念＋コマンドリファレンス第10章、日本語）
  - `docs/er_phase1.md`（ER共通骨格図・英語）
  - `docs/command_spec.md`（コマンド詳細＝デシジョンテーブル＋エッジケース・英語＝TDDのテスト源）

### 次の一手（フェーズ1の実装 ※着手はマスターの「GO」を待つ）
設計は揃った。次はドキュメントでなく**実装**（Claude の見解：これ以上の設計は谷渡りの先延ばし）。
TDD で、以下の順に積む想定：
1. zod スキーマ（10実体：content/deliverable/channel/release/asset_kind/asset/deliverable_asset/task/slot/assignment）。
2. SQLite 読み書き層（正本 .db）。
3. CSV 吐き出し＋git commit の番人（.db と CSV をセットで更新）。
4. CLI パーサ（`gentask <名詞> <動詞>`）。
5. 各コマンド実装＋TDD（`docs/command_spec.md` のデシジョンテーブル／エッジケースをテスト化）。
   まず中核7コマンド：slot log / content add / task add / task move / release add / release done / deliverable add。
- 言語 TypeScript、型は素の zod、旧 gentask の genkit/googleapis は使わない。旧コード（bin/src の google 系）は触らず、後で退役。
- ※前回、指示なく実装（lib/schema.ts）を書いて破棄した。**実装は明確な GO があるまで書かない。**

### フェーズ2・3（さらに先。今は着手しない）
- フェーズ2：種別別 detail（マンガ series/edition/episode、アプリ version/stage、書籍 章/巻）をクラステーブル継承で。
  file テーブル、ver と file の関係、deliverable の再接続（content 直下→episode 直下の可能性）。マンガの版×話数×言語が難所。
- フェーズ3：会話層（LLM が生の事実をコマンドに翻訳＋検証関門）、ダッシュボード、編集者エージェント（効用/緊張度/キャラ、Animo 思想）、販売管理（price/sale）。
- 「全部（1〜3）」の完成は遠い（M365/Zoho で頓挫した規模を自分のモデルで作り直す）。
  **モデルは基幹システムを見据えて正しく、実装は締切を回す最小＝フェーズ1から。** フェーズ1が動けば幹は回り始める。

## ⚠️ Claude への最重要教訓（今回のセッションで痛感）
- **GO なしにコミット・プッシュ・実装しない。コミットメッセージも承認制。**「自律で」と言われても承認は飛ばさない。
- **決めるな。**「決定」「確定」「FA」を安易に使わない。決めるのはマスター。
- **ゼロイチは無力。** 事業の本質・中心の抽象を掴むのはマスター。Claude は聞いて・掴んで・図にして・記録する側。
- **推測を先走らせない／丸投げしない。** 真意を注意深く掴む。頓珍漢な抽象化・支離滅裂な一般化・選択肢の丸投げは不要。Claude が構造の責任を持って叩き台を出す。
- **迎合するな。逆張りもするな。** 素直に真意を受け取る。
- ビルドチェックは**実環境（ブラウザの mermaid 11 系）まで**確認する。mmdc だけで通ったと言わない。
  （mermaid 11.16.0 は ER のリレーション空ラベル `: ""` を syntax error にする。ラベルは必ず埋める。）
- コミットメッセージ：コロンの後は **Add か Update**（コードは feat: 等も可、動詞始まり）。**60 文字以内**。括弧など汚い記号は使わない。
- 英語ドキュメントに日本語を混ぜない（writing_standard）。

## 📋 プロジェクト概要
- リポジトリ：`hiroxpepe/gentask`（public）。ブランチ `master`。
- 正本仕様：`docs/new_spec_gentask_JP.md`。
- 参照：`docs/er_phase1.md`（ER共通骨格・英語）、`docs/command_spec.md`（コマンド詳細・英語）、
  `README.md`（英語・mermaid図付き）、`README_JP.md`、`docs/standard/`（writing_standard, tech_terms）。

## 🔧 環境セットアップ
- clone して作業。push には hiroxpepe アカウントの PAT（repo スコープ）を都度貼る。git config user は clone 後に設定要（未設定だと commit 失敗）。
- テストは `TZ=Asia/Tokyo npx vitest run`（旧 slide.test.ts が TZ 依存で、無指定だと 1 件落ちる。実害なし）。
- mermaid 実レンダリング検証：`npx puppeteer browsers install chrome` → mmdc に `-p pptr.json`（no-sandbox＋Chromeパス）。
- commit 時 package-lock.json を巻き込まない（npm install で変わる。仕様変更と別に扱う）。

## ✅ データモデルの概念（確定済み・要点）
- **中心はタスクではない。** 世に出る成果物（deliverable）が中心。タスクは末端の工程。世のタスク管理が全部ダメなのは「タスクを中心に置く」から。
- **content が最上位の包含者。** マンガ/アプリ/書籍/3Dモデル販売＝リリース区分。task が結びつく先は content。
- **各 content は固有の概念群を持つ**（クラステーブル継承。フェーズ2）。この粒度に「話の中身＝story」は置かない（story 廃止・series へ）。
- **全 content 共通の骨格＝content / deliverable / release / channel / asset（＋task/slot/assignment）。** 4種別すべてリリースを通せると検証済み。
- **deliverable＝リリースの単位。** 商品は全部 deliverable（3Dモデルも。asset ではない）。
- **asset＝再利用単位のラベリング**（「水着エミリー」）。物理ファイルと 1 対 1 でない（複数ファイルを束ねる、asset ⇔ file は 1 対多）。
- **deliverable ⇔ asset は多対多（中間テーブル）。** 含有ではない（含有なら再利用不可）。
- **分類（--mode/--cat）は 2 層。** CLI 層は分類を決定的な引数で受ける（LLM 不要・手で叩ける）。会話層で LLM が生の事実を分類に翻訳（＝「割り切れなさを人間に背負わせない」）。人間指定の --cat は正しい（設計ミスでない）。
- **1 SQLite モノリスに集約。** マイクロサービス・販売SaaS（freee 等）不採用。基幹システムへ育つ射程はあるが、実装は最小から。

## 📝 その他メモ
- モデリングが 9 割。ER が固まる前に実装へ急がない。ただし設計が実装水準に達したら谷を渡る（＝フェーズ1実装）。
- 「エミリーとねこのオレンジ」が主コンテンツ（世界観）＝大前提。series に生活編・ルシファイトの秘宝編。
- 締切は release.due_at に宿る（「媒体と締切りが不可欠」）。編集者エージェントの緊張度もここから。
