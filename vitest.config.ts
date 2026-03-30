import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        // ESM モジュールとして扱う
        pool: 'forks',
        // タイムアウト設定（外部 API を含まない純粋ユニットテスト前提）
        testTimeout: 10_000,
        // テストファイルのパターン
        include: ['**/*.test.ts'],
        // 型チェック前に tsc が通ることが前提なので型チェックは vitest 側ではスキップ
        typecheck: { enabled: false },
    },
});
