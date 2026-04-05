import * as dotenv from 'dotenv';
import { exec } from 'child_process';

// .env.devから環境変数を読み込む
dotenv.config({ path: '.env.dev' });

console.log('M365 Graph APIへの接続テストを開始します...');
console.log('ターゲット: https://graph.microsoft.com/v1.0/me');

const command = 'az rest --method get --url https://graph.microsoft.com/v1.0/me';

exec(command, (error, stdout, stderr) => {
    if (error) {
        console.error(`コマンドの実行に失敗しました: ${error.message}`);
        if (stderr) {
            console.error('標準エラー:', stderr);
        }
        return;
    }

    if (stderr) {
        // az restは成功時も警告をstderrに出すことがあるため、JSONパースを試みる
        try {
            const result = JSON.parse(stderr);
            if (result.error) {
                console.error('APIエラー:', stderr);
                return;
            }
        } catch (e) {
            // JSONでなければ、単なる警告として表示
            console.warn('警告:', stderr);
        }
    }

    console.log(`
接続に成功しました！ 🎉`);
    console.log('取得したユーザー情報:');
    // stdoutを整形して表示
    try {
        const userInfo = JSON.parse(stdout);
        console.log(JSON.stringify(userInfo, null, 2));
    } catch (e) {
        console.log(stdout);
    }
});
