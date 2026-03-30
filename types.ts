import { z } from 'genkit';

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
      - Purple/Pink: その他、補足カテゴリ`)
});

export type gen_task = z.infer<typeof task_schema>;
