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

    // The delete reports both the chats it unfiled and the group keys (ralph
    // sessions, spawned trees, for-each / map-reduce runs) it unfiled from the
    // group-folder sidecar. Both arrays are always sent, empty folder or not.
    await expect(harness.client.processes.deleteChatFolder(workspaceId, created.folder.id))
      .resolves.toEqual({ deleted: true, unfiled: [], unfiledGroups: [] });
    await expect(harness.client.processes.listChatFolders(workspaceId)).resolves.toEqual({ folders: [] });
  });

  it('files a chat group into a folder and unfiles it when the folder is deleted', async () => {
    harness = await startContractHarness();
    const workspace = await harness.client.workspaces.register({
      name: 'Group Folder Workspace',
      rootPath: harness.dataDir,
    });
    const workspaceId = workspace.id;

    const { folder } = await harness.client.processes.createChatFolder(workspaceId, { name: 'Ralph work' });

    await expect(harness.client.processes.setGroupFolder(workspaceId, 'ralph-session', 'sess-1', folder.id))
      .resolves.toMatchObject({ type: 'ralph-session', groupId: 'sess-1', folderId: folder.id });

    await expect(harness.client.processes.listGroupFolders(workspaceId))
      .resolves.toMatchObject({ assignments: [{ type: 'ralph-session', groupId: 'sess-1', folderId: folder.id }] });

    // Deleting the folder has to reach into the group sidecar too — the group
    // membership is not a child of the folder group, so nothing cascades it.
    await expect(harness.client.processes.deleteChatFolder(workspaceId, folder.id))
      .resolves.toEqual({ deleted: true, unfiled: [], unfiledGroups: ['ralph-session:sess-1'] });

    await expect(harness.client.processes.listGroupFolders(workspaceId))
      .resolves.toMatchObject({ assignments: [] });
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
