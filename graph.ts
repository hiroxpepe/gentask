import { execSync } from 'child_process';

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

        return JSON.parse(execSync(cmd, { input: payload, encoding: 'utf-8' }));
    }
};