import { z } from 'genkit';
import { v4 as uuidv4 } from 'uuid';

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

    sub_role: z.enum(['plot', 'name', 'post', 'other']).default('other')
        .describe(`タスクの工程ロール（スケジューリングとスライド判定に使用）：
      - plot:  プロット作業（PTASK。水14:00・木14:00 に自動配置）
      - name:  ネーム/ラフ作業（PTASK。金14:00 に自動配置）
      - post:  投稿作業（CTASK。スライド前の完了チェック対象）
      - other: 上記以外（翌月曜 09:00 から 30 分ブロック順次配置）`),

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

// ─── Phase 7-8: Gentask メタデータ（双方向リンク + UUID 永続 ID） ────────────

/** notes 埋め込みメタデータのタグプレフィックス */
export const GENTASK_TAG = '[gentask:';

/**
 * @interface gentask_metadata
 * @description Google Tasks の notes フィールド末尾に埋め込む Gentask 管理メタデータ。
 * uuid は不変のため、move_task によるタスク ID 変更後も追跡に使用できる。
 */
export interface gentask_metadata {
    uuid:        string; // 不変 UUID（v4）。move_task を経ても変わらない。
    event_id:    string; // Google Calendar イベント ID
    calendar_id: string; // Google Calendar ID
    list_id:     string; // Google Tasks リスト ID（move_task 後に更新される）
    sub_role:    string; // タスクの工程ロール（'plot' | 'name' | 'post' | 'other'）
}

/** Gentask 管理用の不変 UUID を生成する。 */
export function generate_gentask_uuid(): string {
    return uuidv4();
}

/**
 * @function encode_gentask_metadata
 * @description gentask_metadata を notes 埋め込み文字列にシリアライズする。
 * @returns `[gentask:{...}]` 形式の文字列
 */
export function encode_gentask_metadata(metadata: gentask_metadata): string {
    return `${GENTASK_TAG}${JSON.stringify(metadata)}]`;
}

/**
 * @function decode_gentask_metadata
 * @description notes 文字列から gentask_metadata を抽出する。
 * JSON が壊れている・タグが存在しない場合は null を返す（クラッシュしない）。
 */
export function decode_gentask_metadata(notes: string | undefined | null): gentask_metadata | null {
    if (!notes) return null;
    try {
        const tag_start = notes.lastIndexOf(GENTASK_TAG);
        if (tag_start === -1) return null;

        const json_start = tag_start + GENTASK_TAG.length;
        const json_end   = notes.indexOf(']', json_start);
        if (json_end === -1) return null;

        const json_str = notes.slice(json_start, json_end);
        const parsed   = JSON.parse(json_str) as Partial<gentask_metadata>;

        if (!parsed.uuid || !parsed.event_id || !parsed.calendar_id || !parsed.list_id) {
            return null;
        }
        return parsed as gentask_metadata;
    } catch {
        console.warn('[Gentask] メタデータの解析に失敗しました。notes を確認してください。');
        return null;
    }
}

/**
 * @function strip_gentask_metadata
 * @description notes から Gentask メタデータタグを除去した純粋なテキストを返す。
 */
export function strip_gentask_metadata(notes: string | undefined | null): string {
    if (!notes) return '';
    const tag_start = notes.lastIndexOf(GENTASK_TAG);
    if (tag_start === -1) return notes;
    return notes.slice(0, tag_start).trimEnd();
}

// ─── Phase 2: Google Calendar ↔ Google Tasks 同期 ───────────────────────────

/** AI が判定した同期アクション */
export const sync_action_schema = z.object({
    task_id: z.string()
        .describe('操作対象の Google Tasks タスク ID'),

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

    new_due_date: z.string().optional()
        .describe('reschedule の場合の新しい期限（ISO 8601 形式）'),
});

export type sync_action = z.infer<typeof sync_action_schema>;

/** sync_flow への入力 — Google Calendar イベントの現在状態をまとめたもの */
export type sync_input_item = {
    event_id:       string;   // Google Calendar イベント ID
    task_id:        string;   // Google Tasks タスク ID
    list_id:        string;   // Google Tasks リスト ID
    subject:        string;
    body_content:   string;
    current_status: number;   // 0=未完了, 100=完了（Google Tasks は二値）
};

