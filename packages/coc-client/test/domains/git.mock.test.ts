import { afterEach, describe, expect, it } from 'vitest';
import { CocClient, type GitBranchRangeResponse, type GitCommit, type GitPatchApplyResponse, type GitPatchExportResponse } from '../../src';
import { startMockServer, type MockServer, type RecordedRequest } from '../mock-server';

describe('GitClient mock server contract', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('loads commit details, files, and diffs through encoded git routes', async () => {
    mock = await startMockServer();
    const commit: GitCommit = {
      hash: 'abc123',
      shortHash: 'abc123',
      subject: 'Fix app',
      author: 'Test Author',
      date: '2026-01-01T00:00:00.000Z',
      parentHashes: [],
    };
    mock.on('GET', '/api/workspaces/repo%2Fa/git/commits/abc123', { body: commit });
    mock.on('GET', '/api/workspaces/repo%2Fa/git/commits/abc123/files', {
      body: { files: [{ path: 'src/app.ts', status: 'M', additions: 2, deletions: 1 }] },
    });
    mock.on('GET', '/api/workspaces/repo%2Fa/git/commits/abc123/diff', { body: { diff: 'diff --git a/src/app.ts b/src/app.ts' } });
    const client = createClient(mock);

    await expect(client.git.getCommit('repo/a', 'abc123')).resolves.toEqual(commit);
    await expect(client.git.listCommitFiles('repo/a', 'abc123')).resolves.toEqual({
      files: [{ path: 'src/app.ts', status: 'M', additions: 2, deletions: 1 }],
    });
    await expect(client.git.getCommitDiff('repo/a', 'abc123')).resolves.toEqual({
      diff: 'diff --git a/src/app.ts b/src/app.ts',
    });

    expectGetRequest(mock.requests[0], '/api/workspaces/repo%2Fa/git/commits/abc123');
    expectGetRequest(mock.requests[1], '/api/workspaces/repo%2Fa/git/commits/abc123/files');
    expectGetRequest(mock.requests[2], '/api/workspaces/repo%2Fa/git/commits/abc123/diff');
  });

  it('loads branch-range metadata, files, and diff through git routes', async () => {
    mock = await startMockServer();
    const range: GitBranchRangeResponse = {
      baseRef: 'main',
      headRef: 'feature',
      commitCount: 1,
      additions: 3,
      deletions: 1,
      mergeBase: 'abc123',
      branchName: 'feature',
      fileCount: 1,
    };
    mock.on('GET', '/api/workspaces/repo%2Fa/git/branch-range', { body: range });
    mock.on('GET', '/api/workspaces/repo%2Fa/git/branch-range/files', {
      body: { files: [{ path: 'src/branch.ts', status: 'M', additions: 3, deletions: 1 }] },
    });
    mock.on('GET', '/api/workspaces/repo%2Fa/git/branch-range/diff', { body: { diff: 'branch diff' } });
    const client = createClient(mock);

    await expect(client.git.getBranchRange('repo/a')).resolves.toEqual(range);
    await expect(client.git.listBranchRangeFiles('repo/a')).resolves.toEqual({
      files: [{ path: 'src/branch.ts', status: 'M', additions: 3, deletions: 1 }],
    });
    await expect(client.git.getBranchRangeDiff('repo/a')).resolves.toEqual({ diff: 'branch diff' });

    expectGetRequest(mock.requests[0], '/api/workspaces/repo%2Fa/git/branch-range');
    expectGetRequest(mock.requests[1], '/api/workspaces/repo%2Fa/git/branch-range/files');
    expectGetRequest(mock.requests[2], '/api/workspaces/repo%2Fa/git/branch-range/diff');
  });

  it('calls branch, working-tree, and binding routes through encoded workspace paths', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/workspaces/repo%2Fa/git/branches', {
      body: { local: { branches: [{ name: 'feature/a', isCurrent: false, isRemote: false }], totalCount: 1, hasMore: false } },
    });
    mock.on('POST', '/api/workspaces/repo%2Fa/git/branches/switch', { body: { success: true } });
    mock.on('GET', '/api/workspaces/repo%2Fa/git/changes', {
      body: { changes: [{ filePath: 'src/app.ts', status: 'M', stage: 'unstaged', repositoryRoot: 'repo', repositoryName: 'repo' }], repoState: { operation: 'none', conflictFiles: [] } },
    });
    mock.on('POST', '/api/workspaces/repo%2Fa/git/changes/stage', { body: { success: true } });
    mock.on('GET', '/api/workspaces/repo%2Fa/commit-chat-bindings/abc123', { body: { commitHash: 'abc123', taskId: 'task-1' } });
    const client = createClient(mock);

    await expect(client.git.listBranches('repo/a', { type: 'local', search: 'feature/a' })).resolves.toEqual({
      local: { branches: [{ name: 'feature/a', isCurrent: false, isRemote: false }], totalCount: 1, hasMore: false },
    });
    await expect(client.git.switchBranch('repo/a', 'feature/a')).resolves.toEqual({ success: true });
    await expect(client.git.getWorkingTreeChanges('repo/a')).resolves.toMatchObject({ changes: [{ filePath: 'src/app.ts' }] });
    await expect(client.git.stageFile('repo/a', 'src/app.ts')).resolves.toEqual({ success: true });
    await expect(client.git.getCommitChatBinding('repo/a', 'abc123')).resolves.toEqual({ commitHash: 'abc123', taskId: 'task-1' });

    expectGetRequest(mock.requests[0], '/api/workspaces/repo%2Fa/git/branches', { type: 'local', search: 'feature/a' });
    expectPostRequest(mock.requests[1], '/api/workspaces/repo%2Fa/git/branches/switch', { name: 'feature/a' });
    expectGetRequest(mock.requests[2], '/api/workspaces/repo%2Fa/git/changes');
    expectPostRequest(mock.requests[3], '/api/workspaces/repo%2Fa/git/changes/stage', { filePath: 'src/app.ts' });
    expectGetRequest(mock.requests[4], '/api/workspaces/repo%2Fa/commit-chat-bindings/abc123');
  });

  it('exports and applies commit patches through typed patch-transfer routes', async () => {
    mock = await startMockServer();
    const exported: GitPatchExportResponse = {
      sourceWorkspace: { id: 'source/ws', name: 'Source Repo' },
      sourceCommit: {
        hash: 'abc123',
        subject: 'Fix app',
        author: { name: 'Test Author', email: 'author@example.com', date: '2026-01-01T00:00:00.000Z' },
      },
      normalizedSourceRemoteUrl: 'https://example.com/org/repo.git',
      patch: { format: 'format-patch', body: 'From abc123 Mon Sep 17 00:00:00 2001\n' },
    };
    const applied: GitPatchApplyResponse = {
      success: true,
      targetWorkspace: { id: 'target/ws', name: 'Target Repo' },
      targetBranch: 'main',
      targetHead: 'def456',
      newCommitHash: 'def456',
      stashed: true,
      operation: {
        id: 'cherry-pick-transfer-1',
        workspaceId: 'target/ws',
        op: 'cherry-pick-transfer',
        status: 'success',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:01.000Z',
      },
    };
    mock.on('POST', '/api/workspaces/source%2Fws/git/patch/export', { body: exported });
    mock.on('POST', '/api/workspaces/target%2Fws/git/patch/apply', { body: applied });
    const client = createClient(mock);

    await expect(client.git.exportCommitPatch('source/ws', 'abc123')).resolves.toEqual(exported);
    await expect(client.git.applyCommitPatch('target/ws', {
      patch: exported.patch,
      stashAndContinue: true,
      sourceWorkspace: exported.sourceWorkspace,
      sourceCommit: exported.sourceCommit,
      normalizedSourceRemoteUrl: exported.normalizedSourceRemoteUrl,
    })).resolves.toEqual(applied);

    expectPostRequest(mock.requests[0], '/api/workspaces/source%2Fws/git/patch/export', { hash: 'abc123' });
    expectPostRequest(mock.requests[1], '/api/workspaces/target%2Fws/git/patch/apply', {
      patch: exported.patch,
      stashAndContinue: true,
      sourceWorkspace: exported.sourceWorkspace,
      sourceCommit: exported.sourceCommit,
      normalizedSourceRemoteUrl: exported.normalizedSourceRemoteUrl,
    });
  });

  it('calls diff-comment routes through encoded comment identifiers', async () => {
    mock = await startMockServer();
    const storageKey = 'a'.repeat(64);
    mock.on('GET', '/api/diff-comments/repo-a', { body: { comments: [] } });
    mock.on('PATCH', `/api/diff-comments/repo-a/${storageKey}/comment%2Fid`, {
      body: { comment: { id: 'comment/id', status: 'resolved' } },
    });
    mock.on('POST', '/api/diff-comments/repo-a/resolve-with-ai', { status: 202, body: { taskId: 'task-1', totalCount: 2 } });
    const client = createClient(mock);

    await expect(client.git.listDiffComments('repo-a', { oldRef: 'abc^', newRef: 'abc' })).resolves.toEqual({ comments: [] });
    await expect(client.git.updateDiffComment('repo-a', storageKey, 'comment/id', { status: 'resolved' })).resolves.toEqual({
      comment: { id: 'comment/id', status: 'resolved' },
    });
    await expect(client.git.resolveDiffCommentsWithAI('repo-a', { oldRef: 'abc^', newRef: 'abc' })).resolves.toEqual({
      taskId: 'task-1',
      totalCount: 2,
    });

    expectGetRequest(mock.requests[0], '/api/diff-comments/repo-a', { oldRef: 'abc^', newRef: 'abc' });
    expect(mock.requests[1]).toMatchObject({
      method: 'PATCH',
      path: `/api/diff-comments/repo-a/${storageKey}/comment%2Fid`,
      body: { status: 'resolved' },
    });
    expectPostRequest(mock.requests[2], '/api/diff-comments/repo-a/resolve-with-ai', { oldRef: 'abc^', newRef: 'abc' });
  });
});

function createClient(mock: MockServer): CocClient {
  return new CocClient({ baseUrl: mock.url, fetch: globalThis.fetch });
}

function expectGetRequest(request: RecordedRequest, path: string, query: Record<string, string> = {}): void {
  expect(request).toMatchObject({
    method: 'GET',
    path,
    query,
    rawBody: '',
    body: undefined,
  });
  expect(request.headers['content-type']).toBeUndefined();
}

function expectPostRequest(request: RecordedRequest, path: string, body: Record<string, unknown>): void {
  expect(request).toMatchObject({
    method: 'POST',
    path,
    body,
  });
  expect(request.headers['content-type']).toContain('application/json');
}
