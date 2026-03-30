/**
 * @module env
 * @description 起動時に必須の環境変数が揃っているかを検証するモジュール。
 * 欠損がある場合は明確なエラーメッセージを表示して即座に終了する。
 */

const REQUIRED_VARS = [
    'M365_USER_ID',
    'M365_PLANNER_PTASK_GROUP_ID',
    'M365_PLANNER_TTASK_GROUP_ID',
    'M365_PLANNER_CTASK_GROUP_ID',
    'M365_PLANNER_ATASK_GROUP_ID',
    'GCP_VERTEX_AI_API_KEY',
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
