/**
 * @module env
 * @description 起動時に必須の環境変数が揃っているかを検証するモジュール。
 * 欠損がある場合は明確なエラーメッセージを表示して即座に終了する。
 */

const REQUIRED_VARS = [
    'GCP_VERTEX_AI_API_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_CALENDAR_ID',
] as const;

/**
 * @function validate_env
 * @description 必須環境変数の存在を確認する。欠損があれば process.exit(1) で終了。
 */
export function validate_env(): void {
    const missing = REQUIRED_VARS.filter(key => !process.env[key]);
    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:');
        missing.forEach(key => console.error(`   - ${key}`));
        console.error('\nCheck your .env file and try again.');
        process.exit(1);
    }
}
