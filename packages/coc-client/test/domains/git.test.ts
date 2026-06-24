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
    await client.getCommitFileDiff('repo/a', 'abc/123', 'src/app file.ts', { full: true });
    await client.getCommitFileContent('repo/a', 'abc/123', 'src/app file.ts');
    await client.getBranchRange('repo/a', { refresh: true });
    await client.listBranchRangeFiles('repo/a');
    await client.getBranchRangeDiff('repo/a');
    await client.getBranchRangeFileDiff('repo/a', 'src/branch file.ts', { full: true });
    await client.listBranches('repo/a', { type: 'local', limit: 50, offset: 10, search: 'feature/a' });
    await client.deleteBranch('repo/a', 'feature/a space', { force: true });
    await client.switchBranch('repo/a', 'feature/a space', { force: false });
    await client.getWorkingTreeFileDiff('repo/a', 'src/work tree.ts', { stage: 'unstaged', full: true });
    await client.getCommitChatBinding('repo/a', 'abc123');
    await client.startFreshCommitChat('repo/a', 'abc123');
    await client.rebindCommitChatBinding('repo/a', 'abc123', 'def456');
    await client.getDiffCommentCounts('repo-a', { oldRef: 'abc^', newRef: 'abc', status: ['open', 'resolved'] });

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/workspaces/repo%2Fa/git/commits',
      '/workspaces/repo%2Fa/git/commits/abc%2F123',
      '/workspaces/repo%2Fa/git/commits/abc%2F123/files',
      '/workspaces/repo%2Fa/git/commits/abc%2F123/diff',
      '/workspaces/repo%2Fa/git/commits/abc%2F123/files/src%2Fapp%20file.ts/diff',
      '/workspaces/repo%2Fa/git/commits/abc%2F123/files/src%2Fapp%20file.ts/content',
      '/workspaces/repo%2Fa/git/branch-range',
      '/workspaces/repo%2Fa/git/branch-range/files',
      '/workspaces/repo%2Fa/git/branch-range/diff',
      '/workspaces/repo%2Fa/git/branch-range/files/src%2Fbranch%20file.ts/diff',
      '/workspaces/repo%2Fa/git/branches',
      '/workspaces/repo%2Fa/git/branches/feature%2Fa%20space',
      '/workspaces/repo%2Fa/git/branches/switch',
      '/workspaces/repo%2Fa/git/changes/files/src%2Fwork%20tree.ts/diff',
      '/workspaces/repo%2Fa/commit-chat-bindings/abc123',
      '/workspaces/repo%2Fa/commit-chat-bindings/abc123/fresh',
      '/workspaces/repo%2Fa/commit-chat-bindings/rebind',
      '/diff-comment-counts/repo-a',
    ]);
    expect(adapter.calls[0].options?.query).toEqual({
      limit: 50,
      skip: 2,
      refresh: true,
      search: 'fix app',
    });
    expect(adapter.calls[4].options?.query).toEqual({ full: true });
    expect(adapter.calls[6].options?.query).toEqual({ refresh: true });
    expect(adapter.calls[9].options?.query).toEqual({ full: true });
    expect(adapter.calls[10].options?.query).toEqual({
      type: 'local',
      limit: 50,
      offset: 10,
      search: 'feature/a',
    });
    expect(adapter.calls[11].options).toMatchObject({ method: 'DELETE', query: { force: true } });
    expect(adapter.calls[12].options).toMatchObject({ method: 'POST', body: { name: 'feature/a space', force: false } });
    expect(adapter.calls[13].options?.query).toEqual({ stage: 'unstaged', full: true });
    expect(adapter.calls[15].options).toMatchObject({ method: 'POST', body: {} });
    expect(adapter.calls[16].options).toMatchObject({ method: 'POST', body: { oldHash: 'abc123', newHash: 'def456' } });
    expect(adapter.calls[17].options?.query).toEqual({ oldRef: 'abc^', newRef: 'abc', status: 'open,resolved' });
  });

  it('exposes the commit diff route for cache-based SPA consumers', () => {
    const adapter = createMockAdapter({});
    const client = new GitClient(adapter);

    expect(client.commitDiffPath('repo/a space/%', 'abc/123')).toBe(
      '/workspaces/repo%2Fa%20space%2F%25/git/commits/abc%2F123/diff',
    );
    expect(client.commitFileDiffPath('repo/a space/%', 'abc/123', 'src/a file.ts')).toBe(
      '/workspaces/repo%2Fa%20space%2F%25/git/commits/abc%2F123/files/src%2Fa%20file.ts/diff',
    );
    expect(client.branchRangeFileDiffPath('repo/a space/%', 'src/a file.ts')).toBe(
      '/workspaces/repo%2Fa%20space%2F%25/git/branch-range/files/src%2Fa%20file.ts/diff',
    );
  });

  it('posts startFreshCommitChat to the workspace-scoped fresh endpoint', async () => {
    const response = { commitHash: 'abc/123', archivedTaskId: 'task-existing' };
    const adapter = createMockAdapter(response);
    const client = new GitClient(adapter);

    await expect(client.startFreshCommitChat('repo/a', 'abc/123')).resolves.toBe(response);

    expect(adapter.calls).toEqual([
      {
        path: '/workspaces/repo%2Fa/commit-chat-bindings/abc%2F123/fresh',
        options: { method: 'POST', body: {} },
      },
    ]);
  });

  it('calls working-tree and operation routes with typed request bodies', async () => {
    const adapter = createMockAdapter({});
    const client = new GitClient(adapter);

    await client.getRepoState('repo/a');
    await client.getLatestOperation('repo/a', { op: 'pull' });
    await client.getOperation('repo/a', 'pull/job 1');
    await client.fetch('repo/a', { remote: 'origin' });
    await client.pull('repo/a', { rebase: true });
    await client.push('repo/a', { setUpstream: true });
    await client.pushTo('repo/a', 'abc123');
    await client.rebaseAutosquash('repo/a');
    await client.reset('repo/a', 'abc123', 'hard');
    await client.cherryPick('repo/a', 'def456', { hashes: ['abc123', 'def456'], targetBranch: 'release' });
    await client.exportCommitPatch('repo/a', 'def456');
    await client.exportCommitPatches('repo/a', ['abc123', 'def456']);
    await client.applyCommitPatch('repo/a', {
      patch: { format: 'format-patch', body: 'From abc123 Mon Sep 17 00:00:00 2001\n' },
      stashAndContinue: true,
      sourceWorkspace: { id: 'source/ws', name: 'Source Repo' },
      sourceCommit: { hash: 'def456', subject: 'Fix app' },
      normalizedSourceRemoteUrl: 'https://example.com/org/repo.git',
    });
    await client.amend('repo/a', 'new title', 'body');
    await client.reword('repo/a', 'abc123', 'new title');
    await client.rebaseContinue('repo/a');
    await client.mergeAbort('repo/a');
    await client.rebaseReorder('repo/a', ['abc123', 'def456']);
    await client.getWorkingTreeChanges('repo/a');
    await client.stageFile('repo/a', 'src/a.ts');
    await client.unstageFile('repo/a', 'src/a.ts');
    await client.discardFile('repo/a', 'src/a.ts');
    await client.deleteUntrackedFile('repo/a', 'src/a.ts');
    await client.stageFiles('repo/a', ['src/a.ts', 'src/b.ts']);
    await client.unstageFiles('repo/a', ['src/a.ts', 'src/b.ts']);

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/workspaces/repo%2Fa/git/repo-state',
      '/workspaces/repo%2Fa/git/ops/latest',
      '/workspaces/repo%2Fa/git/ops/pull%2Fjob%201',
      '/workspaces/repo%2Fa/git/fetch',
      '/workspaces/repo%2Fa/git/pull',
      '/workspaces/repo%2Fa/git/push',
      '/workspaces/repo%2Fa/git/push-to',
      '/workspaces/repo%2Fa/git/rebase-autosquash',
      '/workspaces/repo%2Fa/git/reset',
      '/workspaces/repo%2Fa/git/cherry-pick',
      '/workspaces/repo%2Fa/git/patch/export',
      '/workspaces/repo%2Fa/git/patch/export',
      '/workspaces/repo%2Fa/git/patch/apply',
      '/workspaces/repo%2Fa/git/amend',
      '/workspaces/repo%2Fa/git/reword',
      '/workspaces/repo%2Fa/git/rebase-continue',
      '/workspaces/repo%2Fa/git/merge-abort',
      '/workspaces/repo%2Fa/git/rebase-reorder',
      '/workspaces/repo%2Fa/git/changes',
      '/workspaces/repo%2Fa/git/changes/stage',
      '/workspaces/repo%2Fa/git/changes/unstage',
      '/workspaces/repo%2Fa/git/changes/discard',
      '/workspaces/repo%2Fa/git/changes/untracked',
      '/workspaces/repo%2Fa/git/changes/stage-batch',
      '/workspaces/repo%2Fa/git/changes/unstage-batch',
    ]);
    expect(adapter.calls[1].options?.query).toEqual({ op: 'pull' });
    expect(adapter.calls[3].options).toMatchObject({ method: 'POST', body: { remote: 'origin' } });
    expect(adapter.calls[4].options).toMatchObject({ method: 'POST', body: { rebase: true } });
    expect(adapter.calls[8].options).toMatchObject({ method: 'POST', body: { hash: 'abc123', mode: 'hard' } });
    expect(adapter.calls[9].options).toMatchObject({
      method: 'POST',
      body: { hash: 'def456', hashes: ['abc123', 'def456'], targetBranch: 'release' },
    });
    expect(adapter.calls[10].options).toMatchObject({ method: 'POST', body: { hash: 'def456' } });
    expect(adapter.calls[11].options).toMatchObject({ method: 'POST', body: { hashes: ['abc123', 'def456'] } });
    expect(adapter.calls[12].options).toMatchObject({
      method: 'POST',
      body: {
        patch: { format: 'format-patch', body: 'From abc123 Mon Sep 17 00:00:00 2001\n' },
        stashAndContinue: true,
        sourceWorkspace: { id: 'source/ws', name: 'Source Repo' },
        sourceCommit: { hash: 'def456', subject: 'Fix app' },
        normalizedSourceRemoteUrl: 'https://example.com/org/repo.git',
      },
    });
    expect(adapter.calls[22].options).toMatchObject({ method: 'DELETE', body: { filePath: 'src/a.ts' } });
    expect(adapter.calls[23].options).toMatchObject({ method: 'POST', body: { filePaths: ['src/a.ts', 'src/b.ts'] } });
  });

  it('calls diff-comment and commit-chat routes with encoded identifiers', async () => {
    const adapter = createMockAdapter({});
    const client = new GitClient(adapter);

    await client.listDiffComments('repo-a', { oldRef: 'feature/base', newRef: 'feature/head' });
    await client.createDiffComment('repo-a', { context: {}, selection: {}, selectedText: 'code', comment: 'fix' });
    await client.updateDiffComment('repo-a', 'a'.repeat(64), 'comment/id', { status: 'resolved' });
    await client.deleteDiffComment('repo-a', 'a'.repeat(64), 'comment/id');
    await client.askDiffCommentAI('repo-a', 'a'.repeat(64), 'comment/id', { commandId: 'explain' });
    await client.resolveDiffCommentsWithAI('repo-a', { oldRef: 'a', newRef: 'b', filePath: 'src/a.ts', skills: ['review'] });
    await client.listCommitChatBindings('repo/a');
    await client.createCommitChatBinding('repo/a', 'abc123', 'task/1');
    await client.deleteCommitChatBinding('repo/a', 'abc123');
    await client.startFreshCommitChat('repo/a', 'abc123');

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/diff-comments/repo-a',
      '/diff-comments/repo-a',
      `/diff-comments/repo-a/${'a'.repeat(64)}/comment%2Fid`,
      `/diff-comments/repo-a/${'a'.repeat(64)}/comment%2Fid`,
      `/diff-comments/repo-a/${'a'.repeat(64)}/comment%2Fid/ask-ai`,
      '/diff-comments/repo-a/resolve-with-ai',
      '/workspaces/repo%2Fa/commit-chat-bindings',
      '/workspaces/repo%2Fa/commit-chat-bindings',
      '/workspaces/repo%2Fa/commit-chat-bindings/abc123',
      '/workspaces/repo%2Fa/commit-chat-bindings/abc123/fresh',
    ]);
    expect(adapter.calls[0].options?.query).toEqual({ oldRef: 'feature/base', newRef: 'feature/head' });
    expect(adapter.calls[1].options).toMatchObject({ method: 'POST' });
    expect(adapter.calls[2].options).toMatchObject({ method: 'PATCH', body: { status: 'resolved' } });
    expect(adapter.calls[3].options).toMatchObject({ method: 'DELETE' });
    expect(adapter.calls[4].options).toMatchObject({ method: 'POST', body: { commandId: 'explain', customQuestion: undefined } });
    expect(adapter.calls[5].options).toMatchObject({
      method: 'POST',
      body: { oldRef: 'a', newRef: 'b', filePath: 'src/a.ts', skills: ['review'] },
    });
    expect(adapter.calls[7].options).toMatchObject({ method: 'POST', body: { commitHash: 'abc123', taskId: 'task/1' } });
    expect(adapter.calls[9].options).toMatchObject({ method: 'POST', body: {} });
  });
});
