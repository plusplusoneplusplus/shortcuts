import { describe, expect, it } from 'vitest';
import { GitClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('GitClient', () => {
  it('calls commit and branch-range routes with encoded workspace and ref segments', async () => {
    const adapter = createMockAdapter({});
    const client = new GitClient(adapter);

    await client.listCommits('repo/a', { limit: 50, skip: 2, refresh: true, search: 'fix app' });
    await client.getCommit('repo/a', 'abc/123');
    await client.listCommitFiles('repo/a', 'abc/123');
    await client.getCommitDiff('repo/a', 'abc/123');
    await client.getBranchRange('repo/a', { refresh: true });
    await client.listBranchRangeFiles('repo/a');
    await client.getBranchRangeDiff('repo/a');

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/workspaces/repo%2Fa/git/commits',
      '/workspaces/repo%2Fa/git/commits/abc%2F123',
      '/workspaces/repo%2Fa/git/commits/abc%2F123/files',
      '/workspaces/repo%2Fa/git/commits/abc%2F123/diff',
      '/workspaces/repo%2Fa/git/branch-range',
      '/workspaces/repo%2Fa/git/branch-range/files',
      '/workspaces/repo%2Fa/git/branch-range/diff',
    ]);
    expect(adapter.calls[0].options?.query).toEqual({
      limit: 50,
      skip: 2,
      refresh: true,
      search: 'fix app',
    });
    expect(adapter.calls[4].options?.query).toEqual({ refresh: true });
  });

  it('exposes the commit diff route for cache-based SPA consumers', () => {
    const adapter = createMockAdapter({});
    const client = new GitClient(adapter);

    expect(client.commitDiffPath('repo/a space/%', 'abc/123')).toBe(
      '/workspaces/repo%2Fa%20space%2F%25/git/commits/abc%2F123/diff',
    );
  });
});
