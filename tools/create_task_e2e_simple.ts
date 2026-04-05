import * as dotenv from 'dotenv';
import { graph } from '../lib/graph';
import { PlannerContainerManager } from '../src/container_manager';

dotenv.config({ path: '.env.dev' });

console.log('M365 Planner タスク作成（シンプル版）E2Eテストを開始します...');

async function main() {
  try {
    const containerManager = new PlannerContainerManager();

    // 1. Get Plan and Bucket
    const { plan_id, buckets } = await containerManager.get_container('PTASK');
    const bucket_id = buckets['current'];

    if (!plan_id || !bucket_id) {
      console.error('プランまたはバケットが見つかりません。');
      return;
    }

    const taskTitle = `[Gentask E2E] これは ${new Date().toLocaleString('ja-JP')} の自動テストタスクです`;;
    console.log(`作成するタスク: "${taskTitle}"`);

    // 2. Create Planner Task
    const plannerTask = await graph.post('https://graph.microsoft.com/v1.0/planner/tasks', {
      planId: plan_id,
      bucketId: bucket_id,
      title: taskTitle,
    });
    console.log('Plannerタスクの作成に成功しました！');
    console.log('  - Task ID:', plannerTask.id);
    console.log(`E2E（シンプル版）テストが正常に完了しました！`);

  } catch (error: any) {
    console.error('E2E（シンプル版）テストの実行中にエラーが発生しました:', error.message);
    if (error.response) {
      console.error('APIレスポンス:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

main();
