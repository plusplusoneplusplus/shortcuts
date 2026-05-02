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
    await client.gitInfo('repo/a');
    await client.deleteHistory('repo/a', 'proc/1');

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/workspaces',
      '/workspaces',
      '/workspaces/discover',
      '/workspaces/repo%2Fa/git-info',
      '/workspaces/repo%2Fa/history/proc%2F1',
    ]);
    expect(adapter.calls[2].options?.query).toEqual({ path: 'C:\\repos' });
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
