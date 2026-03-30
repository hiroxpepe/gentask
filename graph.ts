import { spawn } from 'child_process';

/**
 * @function run_az
 * @description az rest コマンドを非同期で実行し、JSON レスポンスを返す。
 * stdin 経由でボディを渡す（シェルインジェクション対策）。
 */
function run_az(args: string[], input?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = spawn('az', args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

        proc.on('close', (code) => {
            if (code !== 0) reject(new Error(`az rest failed (exit ${code}): ${stderr}`));
            else resolve(stdout);
        });

        if (input) {
            proc.stdin.write(input);
        }
        proc.stdin.end();
    });
}

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
     * @returns {Promise<any>} API から返却された JSON レスポンス
     */
    post: async (url: string, body: object): Promise<any> => {
        const payload = JSON.stringify(body);
        // --body @- は標準入力からデータを読み込む指定。エスケープ問題を回避する最も安全な方法。
        const stdout = await run_az(['rest', '--method', 'post', '--url', url, '--body', '@-'], payload);
        return JSON.parse(stdout);
    },

    get: async (url: string): Promise<any> => {
        const stdout = await run_az(['rest', '--method', 'get', '--url', url]);
        return JSON.parse(stdout);
    },

    patch: async (url: string, body: object, headers: Record<string, string> = {}): Promise<any> => {
        const payload = JSON.stringify(body);
        const header_args = Object.entries(headers).flatMap(([k, v]) => ['--header', `${k}=${v}`]);
        const stdout = await run_az(['rest', '--method', 'patch', '--url', url, '--body', '@-', ...header_args], payload);
        return stdout.trim() ? JSON.parse(stdout) : {};
    }
};