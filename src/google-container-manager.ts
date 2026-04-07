/**
 * @file src/google-container-manager.ts
 * @description Google Tasks リストのライフサイクルを管理するクラス。
 * モード（PTASK/TTASK/CTASK/ATASK）ごとに 今週分・来週分・完了 の 3 リストを
 * Google Tasks 上で自動作成・取得し、ローカルキャッシュ（~/.gentask/tasklists.json）に保存する。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { google } from 'googleapis';
import type { bucket_role } from '../lib/types';

/** キャッシュファイルのパス */
const CACHE_FILE = path.join(os.homedir(), '.gentask', 'tasklists.json');

/**
 * バケットロールと Google Tasks リスト名の対応表。
 * リスト名は `gentask_{mode}_{label}` の形式で構成される。
 */
const BUCKET_LABELS: Record<bucket_role, string> = {
    current: '今週分',
    next:    '来週分',
    done:    '完了',
};

/**
 * @class GoogleContainerManager
 * @description モードごとの Google Tasks リストコンテナを管理する。
 * 初期化時にキャッシュを読み込み、未キャッシュのモードは API で取得・作成してキャッシュする。
 */
export class GoogleContainerManager {
    /** モード → バケットロール → リスト ID のローカルキャッシュ */
    private cache: Record<string, Record<bucket_role, string>> = {};

    constructor() {
        try {
            if (fs.existsSync(CACHE_FILE)) {
                this.cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            }
        } catch {
            this.cache = {};
        }
    }

    /**
     * @method get_container
     * @description 指定モードのリストコンテナ（バケットロール → リスト ID）を返す。
     * キャッシュヒットした場合は API を呼ばない。
     * 未キャッシュの場合は Google Tasks API でリスト一覧を取得し、
     * 存在しないリストは新規作成する。結果はキャッシュに保存される。
     * @param mode タスクモード（例: 'PTASK', 'CTASK'）
     * @param auth Google OAuth2 クライアント
     * @returns バケットロール → リスト ID のマップ
     */
    async get_container(mode: string, auth: any): Promise<Record<bucket_role, string>> {
        // 1. キャッシュヒット
        if (this.cache[mode]) return this.cache[mode];

        const tasks_client = google.tasks({ version: 'v1', auth });

        // 2. 既存リストを全件取得
        const list_res = await tasks_client.tasklists.list({ maxResults: 100 });
        const existing = list_res.data.items ?? [];

        const result: Partial<Record<bucket_role, string>> = {};

        for (const role of ['current', 'next', 'done'] as bucket_role[]) {
            const expected_name = `gentask_${mode}_${BUCKET_LABELS[role]}`;
            const found = existing.find(l => l.title === expected_name);

            if (found?.id) {
                result[role] = found.id;
            } else {
                // 3. 存在しなければ新規作成
                const created = await tasks_client.tasklists.insert({
                    requestBody: { title: expected_name },
                });
                result[role] = created.data.id!;
            }
        }

        const container = result as Record<bucket_role, string>;

        // 4. キャッシュ保存
        this.cache[mode] = container;
        fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2));

        return container;
    }
}
