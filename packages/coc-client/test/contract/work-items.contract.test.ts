import { afterEach, describe, expect, it } from 'vitest';
import { startContractHarness, type ContractHarness } from './server-harness';

describe('work items contract', () => {
  let harness: ContractHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('creates, lists, updates, and deletes a work item', async () => {
    harness = await startContractHarness();
    const workspaceId = 'repo-a';

    const created = await harness.client.workItems.create(workspaceId, {
      title: 'Contract task',
      description: 'Created by contract test',
      priority: 'normal',
    });
    expect(created).toMatchObject({ title: 'Contract task', repoId: workspaceId });

    await expect(harness.client.workItems.list(workspaceId)).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({ id: created.id })],
    });

    await expect(harness.client.workItems.update(workspaceId, created.id, { title: 'Updated contract task' }))
      .resolves.toMatchObject({ title: 'Updated contract task' });

    await expect(harness.client.workItems.delete(workspaceId, created.id)).resolves.toBeUndefined();
  });

  it('reads disabled work item sync status through the typed client', async () => {
    harness = await startContractHarness();

    await expect(harness.client.workItems.syncStatus('repo-a')).resolves.toMatchObject({
      enabled: false,
      disabled: true,
      disabledReason: 'sync-disabled',
      maxItems: 200,
      providers: [],
    });
  });

  it('handles plan versions, pin/archive, and review-change flow', async () => {
    harness = await startContractHarness();
    const workspaceId = 'repo-a';

    const created = await harness.client.workItems.create(workspaceId, {
      title: 'Plan contract task',
      description: 'Created by contract test',
      priority: 'normal',
      plan: { content: '# Initial plan', resolvedBy: 'user' },
    });

    await expect(harness.client.workItems.updatePlan(workspaceId, created.id, '# Updated plan', {
      summary: 'Updated plan',
    })).resolves.toMatchObject({
      version: 2,
      plan: { version: 2, content: '# Updated plan' },
    });

    await expect(harness.client.workItems.planVersions(workspaceId, created.id)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ version: 2, content: '# Updated plan' })]),
    );
    await expect(harness.client.workItems.getPlanVersion(workspaceId, created.id, 2))
      .resolves.toMatchObject({ version: 2, content: '# Updated plan' });

    await expect(harness.client.workItems.pin(workspaceId, created.id, true))
      .resolves.toMatchObject({ id: created.id, pinnedAt: expect.any(String) });
    await expect(harness.client.workItems.archive(workspaceId, created.id, true))
      .resolves.toMatchObject({ id: created.id, archivedAt: expect.any(String) });

    await harness.client.workItems.updateStatus(workspaceId, created.id, 'readyToExecute');
    await harness.client.workItems.updateStatus(workspaceId, created.id, 'executing');
    await harness.client.workItems.updateStatus(workspaceId, created.id, 'aiDone');

    await expect(harness.client.workItems.requestChanges(workspaceId, created.id, {
      comments: ['Address the review note'],
    })).resolves.toMatchObject({
      newVersion: 3,
      plan: { version: 3 },
    });
    await expect(harness.client.workItems.get(workspaceId, created.id))
      .resolves.toMatchObject({ status: 'readyToExecute', plan: { version: 3 } });
  });
});
