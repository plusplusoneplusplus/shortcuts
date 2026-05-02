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
});
