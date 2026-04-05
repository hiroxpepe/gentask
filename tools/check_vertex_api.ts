import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';

const ai_engine = genkit({
    plugins: [
        vertexAI({ location: 'asia-northeast1' }),
    ],
    logLevel: 'debug',
    enableTracing: true,
});

async function run() {
    console.log('Vertex AI への接続テストを開始します...');
    console.log('環境変数 GOOGLE_APPLICATION_CREDENTIALS が正しく設定されているか確認してください。');

    try {
        const modelName = 'gemini-2.5-pro';
        console.log(`- 使用モデル: ${modelName}`);
        
        const model = vertexAI.model(modelName);
        const llmResponse = await ai_engine.generate({
            model: model,
            prompt: 'このメッセージが届けば「OK」とだけ返信してください。',
            output: {
                format: 'text',
            },
        });

        const responseText = llmResponse.message.content[0].text.trim();

        if (responseText === 'OK') {
            console.log('✅ Vertex AIへの接続に成功しました！');
            console.log(`   モデルからの応答: ${responseText}`);
        } else {
            throw new Error(`モデルから予期しない応答がありました: ${responseText}`);
        }

    } catch (e) {
        console.error('接続に失敗しました:', e);
        process.exit(1);
    }
}

run();
