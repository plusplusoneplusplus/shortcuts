import { afterEach, describe, expect, it } from 'vitest';
import { startContractHarness, type ContractHarness } from './server-harness';

describe('processes contract', () => {
  let harness: ContractHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('creates, lists, renames, and deletes chat folders through the real routes', async () => {
    harness = await startContractHarness();
    const workspace = await harness.client.workspaces.register({
      name: 'Contract Workspace',
      rootPath: harness.dataDir,
    });
    const workspaceId = workspace.id;

    const created = await harness.client.processes.createChatFolder(workspaceId, { name: 'Auth rewrite', color: 'purple' });
    expect(created.folder).toMatchObject({ name: 'Auth rewrite', color: 'purple', sortIndex: 0 });

    await expect(harness.client.processes.listChatFolders(workspaceId))
      .resolves.toMatchObject({ folders: [{ id: created.folder.id, name: 'Auth rewrite' }] });

    const renamed = await harness.client.processes.updateChatFolder(workspaceId, created.folder.id, { name: 'Auth' });
    expect(renamed.folder.name).toBe('Auth');

    await expect(harness.client.processes.deleteChatFolder(workspaceId, created.folder.id))
      .resolves.toEqual({ deleted: true, unfiled: [] });
    await expect(harness.client.processes.listChatFolders(workspaceId)).resolves.toEqual({ folders: [] });
  });

  it('lists processes through the real route', async () => {
    harness = await startContractHarness();

    await expect(harness.client.processes.list({ limit: 10 })).resolves.toMatchObject({
      processes: expect.any(Array),
      total: expect.any(Number),
      limit: 10,
      offset: 0,
    });
  });
});
