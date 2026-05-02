import { afterEach, describe, expect, it } from 'vitest';
import { CocClient, type GitBranchRangeResponse, type GitCommit } from '../../src';
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
});

function createClient(mock: MockServer): CocClient {
  return new CocClient({ baseUrl: mock.url, fetch: globalThis.fetch });
}

function expectGetRequest(request: RecordedRequest, path: string): void {
  expect(request).toMatchObject({
    method: 'GET',
    path,
    query: {},
    rawBody: '',
    body: undefined,
  });
  expect(request.headers['content-type']).toBeUndefined();
}
