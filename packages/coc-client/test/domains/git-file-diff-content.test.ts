import { describe, expect, it } from 'vitest';
import { GitClient } from '../../src';
import type { GitFileDiffContentResponse } from '../../src';
import { createMockAdapter } from './helpers';

describe('GitClient.getCommitFileDiffContent', () => {
  it('encodes workspace, commit, and filename on each request', async () => {
    const adapter = createMockAdapter({});
    const client = new GitClient(adapter);
    await client.getCommitFileDiffContent('repo/a', 'abc123', 'src/a file.ts');
    await client.getCommitFileDiffContent('repo/b', 'def456', 'src/a file.ts');
    expect(adapter.calls.map(call => call.path)).toEqual([
      '/workspaces/repo%2Fa/git/commits/abc123/files/src%2Fa%20file.ts/diff-content',
      '/workspaces/repo%2Fb/git/commits/def456/files/src%2Fa%20file.ts/diff-content',
    ]);
  });

  describe('GitClient.getBranchRangeFileDiffContent', () => {
    it('routes each workspace with the selected comparison base', async () => {
      const adapter = createMockAdapter({});
      const client = new GitClient(adapter);
      await client.getBranchRangeFileDiffContent('repo/a', 'src/a file.ts');
      await client.getBranchRangeFileDiffContent('repo/b', 'src/a file.ts', { base: 'upstream' });
      await client.getBranchRangeFileDiffContent('repo/a', 'a.ts', { base: 'default-branch' });
      expect(adapter.calls.map(call => call.path)).toEqual([
        '/workspaces/repo%2Fa/git/branch-range/files/src%2Fa%20file.ts/diff-content',
        '/workspaces/repo%2Fb/git/branch-range/files/src%2Fa%20file.ts/diff-content',
        '/workspaces/repo%2Fa/git/branch-range/files/a.ts/diff-content',
      ]);
      expect(adapter.calls.map(call => call.options?.query)).toEqual([
        undefined, { base: 'upstream', refresh: undefined }, { base: 'default-branch', refresh: undefined },
      ]);
    });

    it('preserves the full-text response', async () => {
      const payload: GitFileDiffContentResponse = {
        path: 'a.ts', fileName: 'a.ts', language: 'ts',
        base: { content: 'base\r\n', ref: 'base', exists: true },
        head: { content: 'head\r\n', ref: 'head', exists: true },
        binary: false, tooLarge: false, modifiedMatchesWorkingCopy: true,
      };
      const client = new GitClient(createMockAdapter(payload));
      await expect(client.getBranchRangeFileDiffContent('ws', 'a.ts', { base: 'upstream' })).resolves.toEqual(payload);
    });
  });

  it.each([{}, { binary: true }, { tooLarge: true }])('returns full-text payloads unchanged: %j', async flags => {
    const payload: GitFileDiffContentResponse = {
      path: 'a.ts',
      fileName: 'a.ts',
      language: 'ts',
      base: { content: 'base\r\n', ref: 'abc123', exists: true },
      head: { content: 'head\r\n', ref: 'def456', exists: true },
      binary: false,
      tooLarge: false,
      ...flags,
    };
    const client = new GitClient(createMockAdapter(payload));
    await expect(client.getCommitFileDiffContent('ws', 'def456', 'a.ts')).resolves.toEqual(payload);
  });
});
