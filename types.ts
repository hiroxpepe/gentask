import { z } from 'genkit';

// ─── Phase 3: バケット管理 ────────────────────────────────────────────────────

/**
 * Planner バケットの役割を表す型。
 * current = 今週分, next = 来週分, done = 完了（アーカイブ）
 */
export type bucket_role = 'current' | 'next' | 'done';

export const task_schema = z.object({
    title: z.string().min(1).max(255)
        .describe('タスクの簡潔なタイトル。実行内容が具体的にイメージできるもの。'),

    mode: z.enum(['PTASK', 'TTASK', 'CTASK', 'ATASK'])
        .describe(`タスクの性質に基づく厳密な分類：
      - PTASK: 思考・戦略・言語化・計画（エネルギー高）
      - TTASK: 技術検証・環境構築・実装・手順確立（中エネルギー）
      - CTASK: 制作・デザイン・手作業・コンテンツ作成（低エネルギー）
      - ATASK: 運用・管理・事務・ルーチン（随時）`),

    priority: z.number().min(1).max(9).default(5)
        .describe('Planner API 優先度。1:最優先（緊急）, 3:重要, 5:普通, 9:低。'),

    description: z.string()
        .describe('タスクの具体的な背景、達成条件、またはステップバイステップの手順。'),

    label: z.enum(['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Pink'])
        .describe(`視覚的な意味付けのためのラベル：
      - Red: 火急の対応が必要
      - Blue: 技術的なハードル・調査が必要
      - Green: 成果物に関連
      - Yellow: 検討・レビューが必要
      - Purple/Pink: その他、補足カテゴリ`),

    bucket: z.enum(['current', 'next']).optional()
        .describe('配置先バケット。PTASK はデフォルト "next"（来週分）、それ以外は "current"（今週分）。省略時はモードで自動決定。'),
});

export type gen_task = z.infer<typeof task_schema>;

// ─── Phase 2: Outlook ↔ Planner 同期 ────────────────────────────────────────

/** Outlook カレンダーイベントの必要最小構造 */
export type outlook_event = {
    id: string;
    subject: string;
    body: { contentType: string; content: string };
    start: { dateTime: string; timeZone: string };
    end:   { dateTime: string; timeZone: string };
    extensions?: Array<{ id: string; plannerTaskId?: string }>;
};

/** AI が判定した同期アクション */
export const sync_action_schema = z.object({
    plannerTaskId: z.string()
        .describe('操作対象の Planner タスク ID'),

    action: z.enum(['complete', 'reschedule', 'add_note', 'buffer_consumed', 'no_change', 'undo'])
        .describe(`解釈された操作種別：
      - complete: タスクを完了（"ok"、"完了" などの記述）
      - reschedule: 期限を変更（予定のスライド、"明日やる" など）
      - add_note: メモを追記（進捗コメント、気づきなど）
      - buffer_consumed: バッファを消費したが継続（"神回" 等の超過記述）
      - no_change: 変化なし
      - undo: 直前操作を取り消す（"undo"、"戻して" などの記述）`),

    note: z.string().optional()
        .describe('add_note / buffer_consumed の場合に Planner へ追記するテキスト'),

    newDueDate: z.string().optional()
        .describe('reschedule の場合の新しい期限（ISO 8601 形式）'),
});

export type sync_action = z.infer<typeof sync_action_schema>;

/** sync_flow への入力 — Outlook イベントの現在状態をまとめたもの */
export type sync_input_item = {
    outlookEventId: string;
    plannerTaskId: string;
    subject: string;
    bodyContent: string;
    currentStatus: number; // Planner percentComplete (0 / 50 / 100)
};

