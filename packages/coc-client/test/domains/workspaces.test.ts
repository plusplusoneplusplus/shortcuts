import { describe, expect, it } from 'vitest';
import { WorkspacesClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('WorkspacesClient', () => {
  it('calls workspace list, registration, discovery, git info, and history routes', async () => {
    const adapter = createMockAdapter({});
    const client = new WorkspacesClient(adapter);

    await client.list();
    await client.register({ id: 'repo/a', name: 'Repo', rootPath: 'C:\\repo' });
    await client.discover('C:\\repos');
    await client.browseFolders('C:\\repos', { showHidden: true });
    await client.summary('repo/a', { folder: 'workflows', showArchived: true });
    await client.gitInfo('repo/a');
    await client.gitInfoBatch(['repo/a', 'repo/b']);
    await client.deleteHistory('repo/a', 'proc/1');
    await client.syncMyWork({ actionItems: ['Review PR'] });
    await client.generateMyWorkSummary();
    await client.syncMyLife({ goals: ['Exercise'] });
    await client.generateMyLifeSummary();

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/workspaces',
      '/workspaces',
      '/workspaces/discover',
      '/fs/browse',
      '/workspaces/repo%2Fa/summary',
      '/workspaces/repo%2Fa/git-info',
      '/git-info/batch',
      '/workspaces/repo%2Fa/history/proc%2F1',
      '/my-work/sync',
      '/my-work/generate-summary',
      '/my-life/sync',
      '/my-life/generate-summary',
    ]);
    expect(adapter.calls[2].options?.query).toEqual({ path: 'C:\\repos' });
    expect(adapter.calls[3].options?.query).toEqual({ path: 'C:\\repos', showHidden: true });
    expect(adapter.calls[4].options?.query).toEqual({ folder: 'workflows', showArchived: true });
    expect(adapter.calls[6].options).toMatchObject({
      method: 'POST',
      body: { workspaceIds: ['repo/a', 'repo/b'] },
    });
    expect(adapter.calls[8].options).toMatchObject({
      method: 'POST',
      body: { actionItems: ['Review PR'] },
    });
    expect(adapter.calls[10].options).toMatchObject({
      method: 'POST',
      body: { goals: ['Exercise'] },
    });
  });

  it('encodes workspace and history IDs with special characters once', async () => {
    const adapter = createMockAdapter({});
    const client = new WorkspacesClient(adapter);

    await client.gitInfo('repo/a space/雪%done');
    await client.deleteHistory('repo/a space/雪%done', 'proc/1 snow/雪%done');

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/workspaces/repo%2Fa%20space%2F%E9%9B%AA%25done/git-info',
      '/workspaces/repo%2Fa%20space%2F%E9%9B%AA%25done/history/proc%2F1%20snow%2F%E9%9B%AA%25done',
    ]);
  });
});
