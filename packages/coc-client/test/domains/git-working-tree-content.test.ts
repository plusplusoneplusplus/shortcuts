import { describe, expect, it } from 'vitest';
import { GitClient } from '../../src';
import type { GitWorkingTreeFileContentResponse } from '../../src';
import { createMockAdapter } from './helpers';

describe('GitClient.getWorkingTreeFileContent', () => {
  it('requests the content route with an encoded path and the stage query', async () => {
    const adapter = createMockAdapter({});
    const client = new GitClient(adapter);

    await client.getWorkingTreeFileContent('repo/a', 'src/work tree.ts', 'unstaged');
    await client.getWorkingTreeFileContent('repo/a', '/abs/repo/src/x.ts', 'staged');
    await client.getWorkingTreeFileContent('repo/a', 'new.ts', 'untracked');

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/workspaces/repo%2Fa/git/changes/files/src%2Fwork%20tree.ts/content',
      '/workspaces/repo%2Fa/git/changes/files/%2Fabs%2Frepo%2Fsrc%2Fx.ts/content',
      '/workspaces/repo%2Fa/git/changes/files/new.ts/content',
    ]);
    expect(adapter.calls.map(c => c.options?.query)).toEqual([
      { stage: 'unstaged' },
      { stage: 'staged' },
      { stage: 'untracked' },
    ]);
  });

  it('routes each request to the workspace it was asked for', async () => {
    const adapter = createMockAdapter({});
    const client = new GitClient(adapter);

    await client.getWorkingTreeFileContent('ws-one', 'a.ts', 'unstaged');
    await client.getWorkingTreeFileContent('ws-two', 'a.ts', 'unstaged');

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/workspaces/ws-one/git/changes/files/a.ts/content',
      '/workspaces/ws-two/git/changes/files/a.ts/content',
    ]);
  });

  it('returns the server payload unchanged, CRLF included', async () => {
    const payload: GitWorkingTreeFileContentResponse = {
      path: 'a.ts',
      fileName: 'a.ts',
      language: 'ts',
      base: { content: 'one\r\ntwo\r\n', ref: 'abc123', exists: true },
      head: { content: 'one\r\n', ref: 'WORKTREE', exists: true },
      binary: false,
      tooLarge: false,
    };
    const adapter = createMockAdapter(payload);
    const client = new GitClient(adapter);

    await expect(client.getWorkingTreeFileContent('ws', 'a.ts', 'unstaged')).resolves.toEqual(payload);
  });
});
