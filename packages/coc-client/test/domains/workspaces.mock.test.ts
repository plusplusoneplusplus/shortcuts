import { afterEach, describe, expect, it } from 'vitest';
import { CocApiError, CocClient, type GitInfoResponse, type WorkspaceInfo } from '../../src';
import {
  mockWorkspace,
  mockWorkspacesResponse,
  startMockServer,
  type MockServer,
  type RecordedRequest,
} from '../mock-server';

describe('WorkspacesClient mock server contract', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('returns workspace lists including an empty server result', async () => {
    mock = await startMockServer();
    const workspace = mockWorkspace({ id: 'repo/one', name: 'Repo One' });
    mock.on('GET', '/api/workspaces', [
      { body: mockWorkspacesResponse([workspace]) },
      { body: mockWorkspacesResponse([]) },
    ]);
    const client = createClient(mock);

    await expect(client.workspaces.list()).resolves.toEqual({ workspaces: [workspace] });
    await expect(client.workspaces.list()).resolves.toEqual({ workspaces: [] });

    expectGetRequest(mock.requests[0], '/api/workspaces');
    expectGetRequest(mock.requests[1], '/api/workspaces');
  });

  it('serializes discovery query parameters and git info paths with null branches', async () => {
    mock = await startMockServer();
    const discovery = { repos: [{ path: 'C:\\repos\\repo-a', name: 'repo-a' }] };
    const browse = {
      path: 'C:\\repos with spaces',
      parent: 'C:\\',
      entries: [{ name: 'repo-a', type: 'directory', isGitRepo: true }],
      drives: ['C:\\'],
    };
    const summary = { workflows: [{ name: 'review' }], tasks: { name: 'tasks' } };
    const gitInfo: GitInfoResponse = {
      branch: null,
      dirty: false,
      isGitRepo: false,
      remoteUrl: null,
    };
    mock.on('GET', '/api/workspaces/discover', { body: discovery });
    mock.on('GET', '/api/fs/browse', { body: browse });
    mock.on('GET', '/api/workspaces/repo%2Fa%20space%25%E9%9B%AA/summary', { body: summary });
    mock.on('GET', '/api/workspaces/repo%2Fa%20space%25%E9%9B%AA/git-info', { body: gitInfo });
    mock.on('POST', '/api/git-info/batch', { body: { results: { 'repo/a space%雪': gitInfo } } });
    const client = createClient(mock);

    await expect(client.workspaces.discover('C:\\repos with spaces')).resolves.toEqual(discovery);
    await expect(client.workspaces.browseFolders('C:\\repos with spaces', { showHidden: true })).resolves.toEqual(browse);
    await expect(client.workspaces.summary('repo/a space%雪', { folder: 'flows', showArchived: true })).resolves.toEqual(summary);
    await expect(client.workspaces.gitInfo('repo/a space%雪')).resolves.toEqual(gitInfo);
    await expect(client.workspaces.gitInfoBatch(['repo/a space%雪'])).resolves.toEqual({ results: { 'repo/a space%雪': gitInfo } });

    expectGetRequest(mock.requests[0], '/api/workspaces/discover', { path: 'C:\\repos with spaces' });
    expectGetRequest(mock.requests[1], '/api/fs/browse', { path: 'C:\\repos with spaces', showHidden: 'true' });
    expectGetRequest(mock.requests[2], '/api/workspaces/repo%2Fa%20space%25%E9%9B%AA/summary', { folder: 'flows', showArchived: 'true' });
    expectGetRequest(mock.requests[3], '/api/workspaces/repo%2Fa%20space%25%E9%9B%AA/git-info');
    expectJsonRequest(mock.requests[4], 'POST', '/api/git-info/batch', { workspaceIds: ['repo/a space%雪'] });
  });

  it('sends register, update, delete, and history deletion shapes exactly', async () => {
    mock = await startMockServer();
    const registered: WorkspaceInfo = {
      id: 'assigned/repo',
      name: 'Repo Alias',
      rootPath: 'C:\\repos\\repo-a',
      path: 'C:\\repos\\repo-a',
      alias: 'Repo Alias',
      tags: ['team-a', 'active'],
    };
    const updated = mockWorkspace({
      id: 'assigned/repo',
      name: 'Updated Repo',
      description: 'Updated description',
      tags: ['updated'],
    });
    mock.on('POST', '/api/workspaces', { status: 201, body: registered });
    mock.on('PATCH', '/api/workspaces/assigned%2Frepo', { body: { workspace: updated } });
    mock.on('DELETE', '/api/workspaces/assigned%2Frepo', [
      { noContent: true },
      { noContent: true },
    ]);
    mock.on('DELETE', '/api/workspaces/assigned%2Frepo/history', { noContent: true });
    mock.on('DELETE', '/api/workspaces/assigned%2Frepo/history/proc%2Fone', { noContent: true });
    const client = createClient(mock);

    await expect(client.workspaces.register({
      path: 'C:\\repos\\repo-a',
      alias: 'Repo Alias',
      tags: ['team-a', 'active'],
    })).resolves.toEqual(registered);
    await expect(client.workspaces.update('assigned/repo', {
      name: 'Updated Repo',
      description: 'Updated description',
      tags: ['updated'],
    })).resolves.toEqual({ workspace: updated });
    await expect(client.workspaces.delete('assigned/repo', { archive: true })).resolves.toBeUndefined();
    await expect(client.workspaces.delete('assigned/repo', { archive: false })).resolves.toBeUndefined();
    await expect(client.workspaces.deleteHistory('assigned/repo', {
      since: '2026-05-01T00:00:00.000Z',
      until: '2026-05-02T00:00:00.000Z',
    })).resolves.toBeUndefined();
    await expect(client.workspaces.deleteHistory('assigned/repo', 'proc/one')).resolves.toBeUndefined();

    expectJsonRequest(mock.requests[0], 'POST', '/api/workspaces', {
      path: 'C:\\repos\\repo-a',
      alias: 'Repo Alias',
      tags: ['team-a', 'active'],
    });
    expectJsonRequest(mock.requests[1], 'PATCH', '/api/workspaces/assigned%2Frepo', {
      name: 'Updated Repo',
      description: 'Updated description',
      tags: ['updated'],
    });
    expectEmptyRequest(mock.requests[2], 'DELETE', '/api/workspaces/assigned%2Frepo', { archive: 'true' });
    expectEmptyRequest(mock.requests[3], 'DELETE', '/api/workspaces/assigned%2Frepo', { archive: 'false' });
    expectEmptyRequest(mock.requests[4], 'DELETE', '/api/workspaces/assigned%2Frepo/history', {
      since: '2026-05-01T00:00:00.000Z',
      until: '2026-05-02T00:00:00.000Z',
    });
    expectEmptyRequest(mock.requests[5], 'DELETE', '/api/workspaces/assigned%2Frepo/history/proc%2Fone');
  });

  it('encodes workspace IDs with slash, space, percent, and unicode as one route segment', async () => {
    mock = await startMockServer();
    const ids = ['repo/with/slash', 'repo with space', 'repo%percent', 'repo雪'];
    const client = createClient(mock);
    const gitInfo: GitInfoResponse = {
      branch: 'main',
      dirty: true,
      ahead: 1,
      behind: 2,
      isGitRepo: true,
      remoteUrl: 'https://example.invalid/repo.git',
    };

    for (const id of ids) {
      mock.on('GET', `/api/workspaces/${encodeURIComponent(id)}/git-info`, { body: gitInfo });
      await expect(client.workspaces.gitInfo(id)).resolves.toEqual(gitInfo);
    }

    expect(mock.requests.map(request => request.path)).toEqual(ids.map(id => (
      `/api/workspaces/${encodeURIComponent(id)}/git-info`
    )));
  });

  it('calls virtual workspace sync and summary routes', async () => {
    mock = await startMockServer();
    mock.on('POST', '/api/my-work/sync', {
      body: { synced: true, date: 'May 2', actionItemCount: 1, followUpCount: 2 },
    });
    mock.on('POST', '/api/my-work/generate-summary', {
      body: { generated: true, path: 'Weekly/2026-W18.md', completedCount: 1, inProgressCount: 2, waitingOnCount: 3 },
    });
    mock.on('POST', '/api/my-life/sync', {
      body: { synced: true, date: 'May 2', goalCount: 1, entryCount: 2 },
    });
    mock.on('POST', '/api/my-life/generate-summary', {
      body: { generated: true, path: 'Weekly/2026-W18.md', completedCount: 1, inProgressCount: 2, journalCount: 3 },
    });
    const client = createClient(mock);

    await expect(client.repos.syncMyWork({ actionItems: ['Ship'], followUps: { Team: ['Review'] } })).resolves.toMatchObject({ actionItemCount: 1 });
    await expect(client.repos.generateMyWorkSummary()).resolves.toMatchObject({ waitingOnCount: 3 });
    await expect(client.repos.syncMyLife({ goals: ['Read'], entries: { Journal: ['Note'] } })).resolves.toMatchObject({ goalCount: 1 });
    await expect(client.repos.generateMyLifeSummary()).resolves.toMatchObject({ journalCount: 3 });

    expectJsonRequest(mock.requests[0], 'POST', '/api/my-work/sync', {
      actionItems: ['Ship'],
      followUps: { Team: ['Review'] },
    });
    expectEmptyJsonRequest(mock.requests[1], 'POST', '/api/my-work/generate-summary');
    expectJsonRequest(mock.requests[2], 'POST', '/api/my-life/sync', {
      goals: ['Read'],
      entries: { Journal: ['Note'] },
    });
    expectEmptyJsonRequest(mock.requests[3], 'POST', '/api/my-life/generate-summary');
  });

  it('propagates workspace error envelopes as CocApiError instances', async () => {
    mock = await startMockServer();
    mock.on('POST', '/api/workspaces', [
      {
        status: 409,
        body: {
          error: {
            message: 'Workspace alias already exists',
            code: 'WORKSPACE_ALIAS_CONFLICT',
            details: { alias: 'Repo Alias' },
          },
        },
      },
      {
        status: 422,
        body: {
          error: {
            message: 'Invalid workspace path',
            code: 'VALIDATION_FAILED',
            details: { fieldErrors: { path: 'Path does not exist' } },
          },
        },
      },
    ]);
    mock.on('PATCH', '/api/workspaces/missing%2Frepo', {
      status: 404,
      body: {
        error: {
          message: 'Workspace not found',
          code: 'WORKSPACE_NOT_FOUND',
          details: { workspaceId: 'missing/repo' },
        },
      },
    });
    mock.on('DELETE', '/api/workspaces/missing%2Frepo', {
      status: 404,
      body: {
        error: {
          message: 'Workspace not found',
          code: 'WORKSPACE_NOT_FOUND',
          details: { workspaceId: 'missing/repo' },
        },
      },
    });
    const client = createClient(mock);

    await expect(client.workspaces.register({ path: 'C:\\repos\\one', alias: 'Repo Alias' })).rejects.toMatchObject({
      name: 'CocApiError',
      status: 409,
      message: 'Workspace alias already exists',
      code: 'WORKSPACE_ALIAS_CONFLICT',
      details: { alias: 'Repo Alias' },
    } satisfies Partial<CocApiError>);
    await expect(client.workspaces.update('missing/repo', { name: 'Missing' })).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
      message: 'Workspace not found',
      code: 'WORKSPACE_NOT_FOUND',
      details: { workspaceId: 'missing/repo' },
    } satisfies Partial<CocApiError>);
    await expect(client.workspaces.delete('missing/repo')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
      message: 'Workspace not found',
      code: 'WORKSPACE_NOT_FOUND',
      details: { workspaceId: 'missing/repo' },
    } satisfies Partial<CocApiError>);
    await expect(client.workspaces.register({ path: 'Z:\\missing', alias: 'Bad Path' })).rejects.toMatchObject({
      name: 'CocApiError',
      status: 422,
      message: 'Invalid workspace path',
      code: 'VALIDATION_FAILED',
      details: { fieldErrors: { path: 'Path does not exist' } },
    } satisfies Partial<CocApiError>);
  });

  it('lists terminal sessions for a workspace', async () => {
    mock = await startMockServer();
    const response = {
      sessions: [
        { id: 'sess-1', pinned: true, workspaceId: 'repo/one' },
        { id: 'sess-2', pinned: false, workspaceId: 'repo/one' },
      ],
    };
    mock.on('GET', '/api/workspaces/repo%2Fone/terminals', { body: response });
    const client = createClient(mock);

    await expect(client.workspaces.listTerminals('repo/one')).resolves.toEqual(response);
    expectGetRequest(mock.requests[0], '/api/workspaces/repo%2Fone/terminals');
  });

  it('pins and unpins a terminal session', async () => {
    mock = await startMockServer();
    const pinResponse = { sessionId: 'sess-1', pinned: true };
    const unpinResponse = { sessionId: 'sess-1', pinned: false };
    mock.on('PATCH', '/api/workspaces/repo%2Fone/terminals/sess-1/pin', [
      { body: pinResponse },
      { body: unpinResponse },
    ]);
    const client = createClient(mock);

    await expect(client.workspaces.pinTerminal('repo/one', 'sess-1', true)).resolves.toEqual(pinResponse);
    expectJsonRequest(mock.requests[0], 'PATCH', '/api/workspaces/repo%2Fone/terminals/sess-1/pin', { pinned: true });

    await expect(client.workspaces.pinTerminal('repo/one', 'sess-1', false)).resolves.toEqual(unpinResponse);
    expectJsonRequest(mock.requests[1], 'PATCH', '/api/workspaces/repo%2Fone/terminals/sess-1/pin', { pinned: false });
  });

  it('reads Ralph session files through the workspace client', async () => {
    mock = await startMockServer();
    const response = {
      record: {
        sessionId: 'sess/1',
        workspaceId: 'repo/one',
        originalGoal: 'inspect files',
        maxIterations: 2,
        currentIteration: 1,
        phase: 'executing',
        startedAt: '2026-06-02T00:00:00.000Z',
        iterations: [],
      },
      sections: [{ iteration: 1, signal: 'RALPH_NEXT', timestamp: 't1', body: 'body' }],
      files: [
        { name: 'progress.md', content: '# Ralph Session' },
        { name: 'session.json', content: '{"sessionId":"sess/1"}' },
      ],
    };
    mock.on('GET', '/api/workspaces/repo%2Fone/ralph-sessions/sess%2F1', { body: response });
    const client = createClient(mock);

    await expect(client.workspaces.ralphSession('repo/one', 'sess/1')).resolves.toEqual(response);
    expectGetRequest(mock.requests[0], '/api/workspaces/repo%2Fone/ralph-sessions/sess%2F1');
  });
});

function createClient(mock: MockServer): CocClient {
  return new CocClient({ baseUrl: mock.url, fetch: globalThis.fetch });
}

function expectGetRequest(request: RecordedRequest, path: string, query: Record<string, string> = {}): void {
  expectEmptyRequest(request, 'GET', path, query);
}

function expectEmptyRequest(
  request: RecordedRequest,
  method: string,
  path: string,
  query: Record<string, string> = {},
): void {
  expect(request).toMatchObject({
    method,
    path,
    query,
    rawBody: '',
    body: undefined,
  });
  expect(request.headers['content-type']).toBeUndefined();
}

function expectEmptyJsonRequest(
  request: RecordedRequest,
  method: string,
  path: string,
): void {
  expect(request).toMatchObject({
    method,
    path,
    query: {},
    rawBody: '',
    body: undefined,
  });
  expect(request.headers['content-type']).toBeUndefined();
}

function expectJsonRequest(
  request: RecordedRequest,
  method: string,
  path: string,
  body: unknown,
  query: Record<string, string> = {},
): void {
  expect(request).toMatchObject({
    method,
    path,
    query,
    rawBody: JSON.stringify(body),
    body,
  });
  expect(request.headers['content-type']).toBe('application/json');
}
