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
});
