import { CocClient } from '@plusplusoneplusplus/coc-client';

const workspaceId = process.env.COC_WORKSPACE_ID;
if (!workspaceId) {
  throw new Error('Set COC_WORKSPACE_ID to the target workspace/repo ID.');
}

const coc = new CocClient({ baseUrl: process.env.COC_BASE_URL ?? 'http://localhost:4000' });

const item = await coc.workItems.create(workspaceId, {
  title: 'Investigate failing workflow',
  description: 'Collect logs and summarize the failure.',
  priority: 'normal',
});

console.log(`Created work item ${item.id}`);

const list = await coc.workItems.list(workspaceId, { limit: 10 });
console.log(`Workspace has ${list.total} work item(s).`);
