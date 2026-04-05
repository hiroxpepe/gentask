import * as dotenv from 'dotenv';
import { graph } from '../lib/graph';
import { PlannerContainerManager } from '../src/container_manager';
import { OutlookService } from '../lib/outlook';
import { gen_task } from '../lib/types';

dotenv.config({ path: '.env.dev' });

const DEFAULT_BLOCK_MINUTES = 30;

console.log('M365 Planner タスク作成E2Eテストを開始します...');

async function main() {
  try {
    const containerManager = new PlannerContainerManager();
    const outlookService = new OutlookService();

    // 1. Get Plan and Bucket
    const { plan_id, buckets } = await containerManager.get_container('PTASK');
    const bucket_id = buckets['current'];

    if (!plan_id || !bucket_id) {
      console.error('プランまたはバケットが見つかりません。');
      return;
    }

    const taskTitle = `E2E Test Task ${new Date().toISOString()}`;
    console.log(`作成するタスク: "${taskTitle}"`);

    // 2. Create Planner Task
    const plannerTask = await graph.post('https://graph.microsoft.com/v1.0/planner/tasks', {
      planId: plan_id,
      bucketId: bucket_id,
      title: taskTitle,
    });
    console.log('Plannerタスクの作成に成功しました！');

    // 3. Create Outlook Calendar Event
    const now = new Date();
    const slot_start = new Date(now);
    const slot_end = new Date(slot_start.getTime() + DEFAULT_BLOCK_MINUTES * 60 * 1000);

    const mock_task: gen_task = {
        title: taskTitle,
        mode: 'PTASK',
        description: 'This is an E2E test task.',
        priority: 5,
        label: 'Red'
    };

    const outlook_event_id = await outlookService.create_event(
        mock_task,
        plannerTask.id as string,
        slot_start.toISOString(),
        slot_end.toISOString()
    );
    console.log(`Outlookカレンダーのイベントを作成しました: ${outlook_event_id}`);

    // 4. Link Planner task to Outlook event
    await graph.post(
        `https://graph.microsoft.com/v1.0/planner/tasks/${plannerTask.id}/extensions`,
        {
            '@odata.type': '#microsoft.graph.openTypeExtension',
            extensionName: 'com.gentask.v1',
            outlookEventId: outlook_event_id,
        }
    );
    console.log('PlannerタスクとOutlookイベントをリンクしました。');

    console.log(`E2Eテストが正常に完了しました！`);

  } catch (error: any) {
    console.error('E2Eテストの実行中にエラーが発生しました:', error.message);
    if (error.response) {
      console.error('APIレスポンス:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

main();
