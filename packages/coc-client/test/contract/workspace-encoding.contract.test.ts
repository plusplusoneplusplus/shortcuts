import { afterEach, describe, expect, it } from 'vitest';
import { CocApiError } from '../../src';
import { startContractHarness, type ContractHarness } from './server-harness';

describe('workspace encoding contract', () => {
  let harness: ContractHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('keeps slashes inside encoded workspace IDs as one route segment', async () => {
    harness = await startContractHarness();
    const workspaceId = 'repo/a';

    const item = await harness.client.workItems.create(workspaceId, { title: 'Encoded workspace' });
    expect(item.repoId).toBe(workspaceId);
    await expect(harness.client.workItems.get(workspaceId, item.id)).resolves.toMatchObject({ id: item.id });

    await expect(harness.client.workspaces.gitInfo(workspaceId)).rejects.toSatisfy((error: unknown) => (
      error instanceof CocApiError
      && error.status === 404
      && error.message.includes('Workspace')
    ));
  });
});
