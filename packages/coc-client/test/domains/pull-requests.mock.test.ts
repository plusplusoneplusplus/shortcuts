import { afterEach, describe, expect, it, vi } from 'vitest';
import { CocApiError, CocClient } from '../../src';
import {
  startMockServer,
  type MockServer,
  type RecordedRequest,
} from '../mock-server';

describe('PullRequestsClient mock coverage', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('reads sanitized provider config without exposing credentials', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/providers/config', {
      body: {
        providers: {
          github: { hasToken: true },
          ado: { orgUrl: 'https://dev.azure.com/org' },
          tavily: { hasApiKey: false },
        },
      },
    });
    const client = createClient(mock);

    await expect(client.pullRequests.getProviderConfig()).resolves.toEqual({
      providers: {
        github: { hasToken: true },
        ado: { orgUrl: 'https://dev.azure.com/org' },
        tavily: { hasApiKey: false },
      },
    });

    expectEmptyRequest(mock.requests[0], 'GET', '/api/providers/config');
  });

  it('saves provider config as JSON and returns undefined for 204 responses', async () => {
    mock = await startMockServer();
    mock.on('PUT', '/api/providers/config', { status: 204, body: undefined });
    const client = createClient(mock);

    await expect(client.pullRequests.saveProviderConfig({
      ado: { orgUrl: 'https://dev.azure.com/org', token: 'ado-token' },
    })).resolves.toBeUndefined();

    expectJsonRequest(mock.requests[0], 'PUT', '/api/providers/config', {
      ado: { orgUrl: 'https://dev.azure.com/org', token: 'ado-token' },
    });
  });

  it('propagates provider validation failures as CocApiError instances', async () => {
    mock = await startMockServer();
    mock.on('PUT', '/api/providers/config', {
      status: 400,
      statusText: 'Bad Request',
      body: { error: 'ado.orgUrl must be a non-empty string' },
    });
    const client = createClient(mock);

    await expect(client.pullRequests.saveProviderConfig({
      ado: { orgUrl: '', token: 'ado-token' },
    })).rejects.toMatchObject({
      name: 'CocApiError',
      status: 400,
      statusText: 'Bad Request',
      message: 'ado.orgUrl must be a non-empty string',
      body: { error: 'ado.orgUrl must be a non-empty string' },
    } satisfies Partial<CocApiError>);
  });

  it('lists pull requests with encoded repo ID and query serialization', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/repos/repo%2Fa/pull-requests', {
      body: {
        pullRequests: [{ id: 1, title: 'Fix bug' }],
        total: 1,
      },
    });
    const client = createClient(mock);

    await expect(client.pullRequests.list('repo/a', {
      status: 'open',
      scope: 'all',
      top: 10,
      skip: 5,
      force: true,
      author: 'dev',
      search: 'bug',
    })).resolves.toEqual({ pullRequests: [{ id: 1, title: 'Fix bug' }], total: 1 });

    expectEmptyRequest(mock.requests[0], 'GET', '/api/repos/repo%2Fa/pull-requests', {
      status: 'open',
      scope: 'all',
      top: '10',
      skip: '5',
      force: 'true',
      author: 'dev',
      search: 'bug',
    });
  });

  it('gets a single PR by repo and PR ID', async () => {
    mock = await startMockServer();
    const pr = { id: 42, title: 'My PR', status: 'active' };
    mock.on('GET', '/api/repos/repo%2Fa/pull-requests/42', { body: pr });
    const client = createClient(mock);

    await expect(client.pullRequests.get('repo/a', '42')).resolves.toEqual(pr);

    expectEmptyRequest(mock.requests[0], 'GET', '/api/repos/repo%2Fa/pull-requests/42');
  });

  it('lists and gets PRs through origin routes with explicit workspace metadata', async () => {
    mock = await startMockServer();
    const pr = { id: 42, title: 'My PR', status: 'active' };
    mock.on('GET', '/api/origins/gh_owner_repo/pull-requests', {
      body: {
        pullRequests: [pr],
        total: 1,
      },
    });
    mock.on('GET', '/api/origins/gh_owner_repo/pull-requests/42', { body: pr });
    const client = createClient(mock);

    await expect(client.pullRequests.listForOrigin('gh_owner_repo', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
      status: 'open',
      scope: 'all',
      top: 10,
      skip: 5,
      force: true,
      author: 'dev',
      search: 'bug',
    })).resolves.toEqual({ pullRequests: [pr], total: 1 });
    await expect(client.pullRequests.getForOrigin('gh_owner_repo', '42', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
      force: true,
    })).resolves.toEqual(pr);

    expectEmptyRequest(mock.requests[0], 'GET', '/api/origins/gh_owner_repo/pull-requests', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
      status: 'open',
      scope: 'all',
      top: '10',
      skip: '5',
      force: 'true',
      author: 'dev',
      search: 'bug',
    });
    expectEmptyRequest(mock.requests[1], 'GET', '/api/origins/gh_owner_repo/pull-requests/42', {
      workspaceId: 'ws/a',
      repoId: 'repo/a',
      force: 'true',
    });
  });

  it('gets provider PR subresources through origin routes with explicit workspace metadata', async () => {
    mock = await startMockServer();
    const diff = 'diff --git a/src/foo.ts b/src/foo.ts\n';
    mock.on('GET', '/api/origins/gh_owner_repo/pull-requests/42/threads', { body: { threads: [{ id: 't-1' }] } });
    mock.on('GET', '/api/origins/gh_owner_repo/pull-requests/42/reviewers', { body: { reviewers: [{ id: 'r-1' }] } });
    mock.on('GET', '/api/origins/gh_owner_repo/pull-requests/42/commits', { body: { commits: [{ id: 'c-1' }] } });
    mock.on('GET', '/api/origins/gh_owner_repo/pull-requests/42/diff', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      rawBody: diff,
    });
    mock.on('GET', '/api/origins/gh_owner_repo/pull-requests/42/checks', { body: { checks: [{ id: 'check-1' }] } });
    const client = createClient(mock);
    const options = { workspaceId: 'ws/a', repoId: 'repo/a' };

    await expect(client.pullRequests.getThreadsForOrigin('gh_owner_repo', '42', options)).resolves.toEqual({ threads: [{ id: 't-1' }] });
    await expect(client.pullRequests.getReviewersForOrigin('gh_owner_repo', '42', options)).resolves.toEqual({ reviewers: [{ id: 'r-1' }] });
    await expect(client.pullRequests.getCommitsForOrigin('gh_owner_repo', '42', options)).resolves.toEqual({ commits: [{ id: 'c-1' }] });
    await expect(client.pullRequests.getDiffForOrigin('gh_owner_repo', '42', options)).resolves.toBe(diff);
    await expect(client.pullRequests.getChecksForOrigin('gh_owner_repo', '42', options)).resolves.toEqual({ checks: [{ id: 'check-1' }] });

    expectEmptyRequest(mock.requests[0], 'GET', '/api/origins/gh_owner_repo/pull-requests/42/threads', options);
    expectEmptyRequest(mock.requests[1], 'GET', '/api/origins/gh_owner_repo/pull-requests/42/reviewers', options);
    expectEmptyRequest(mock.requests[2], 'GET', '/api/origins/gh_owner_repo/pull-requests/42/commits', options);
    expectEmptyRequest(mock.requests[3], 'GET', '/api/origins/gh_owner_repo/pull-requests/42/diff', options);
    expectEmptyRequest(mock.requests[4], 'GET', '/api/origins/gh_owner_repo/pull-requests/42/checks', options);
  });

  it('gets comment threads for a PR', async () => {
    mock = await startMockServer();
    const threads = [{ id: 't-1', comments: [{ content: 'LGTM' }] }];
    mock.on('GET', '/api/repos/repo%2Fa/pull-requests/42/threads', { body: { threads } });
    const client = createClient(mock);

    await expect(client.pullRequests.getThreads('repo/a', '42')).resolves.toEqual({ threads });

    expectEmptyRequest(mock.requests[0], 'GET', '/api/repos/repo%2Fa/pull-requests/42/threads');
  });

  it('gets reviewers for a PR', async () => {
    mock = await startMockServer();
    const reviewers = [{ id: 'r-1', displayName: 'Dev', vote: 10 }];
    mock.on('GET', '/api/repos/repo%2Fa/pull-requests/42/reviewers', { body: { reviewers } });
    const client = createClient(mock);

    await expect(client.pullRequests.getReviewers('repo/a', '42')).resolves.toEqual({ reviewers });

    expectEmptyRequest(mock.requests[0], 'GET', '/api/repos/repo%2Fa/pull-requests/42/reviewers');
  });

  it('gets commits for a PR', async () => {
    mock = await startMockServer();
    const commits = [{ sha: 'abcdef1234567890', shortSha: 'abcdef1', title: 'Fix bug' }];
    mock.on('GET', '/api/repos/repo%2Fa/pull-requests/42/commits', { body: { commits } });
    const client = createClient(mock);

    await expect(client.pullRequests.getCommits('repo/a', '42')).resolves.toEqual({ commits });

    expectEmptyRequest(mock.requests[0], 'GET', '/api/repos/repo%2Fa/pull-requests/42/commits');
  });

  it('gets unified diff as text/plain string via the raw-text transport path', async () => {
    mock = await startMockServer();
    const diff = '--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n+import { foo } from "bar";\n export const x = 1;';
    mock.on('GET', '/api/repos/repo%2Fa/pull-requests/42/diff', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      rawBody: diff,
    });
    const client = createClient(mock);

    await expect(client.pullRequests.getDiff('repo/a', '42')).resolves.toBe(diff);

    expectEmptyRequest(mock.requests[0], 'GET', '/api/repos/repo%2Fa/pull-requests/42/diff');
  });

  it('gets commits for a PR', async () => {
    mock = await startMockServer();
    const commits = [{ id: 'abc1234deadbeef', shortId: 'abc1234', subject: 'feat: x' }];
    mock.on('GET', '/api/repos/repo%2Fa/pull-requests/42/commits', { body: { commits } });
    const client = createClient(mock);

    await expect(client.pullRequests.getCommits('repo/a', '42')).resolves.toEqual({ commits });

    expectEmptyRequest(mock.requests[0], 'GET', '/api/repos/repo%2Fa/pull-requests/42/commits');
  });

  it('propagates 404 on missing PRs as CocApiError', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/repos/repo-a/pull-requests/999', {
      status: 404,
      body: { error: 'Pull request not found' },
    });
    const client = createClient(mock);

    await expect(client.pullRequests.get('repo-a', '999')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
    } satisfies Partial<CocApiError>);
  });

  it('aborts an in-flight list request when the signal is triggered', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/repos/r1/pull-requests', {
      body: { pullRequests: [], total: 0 },
      delayMs: 200,
    });
    const client = createClient(mock);
    const controller = new AbortController();

    const promise = client.pullRequests.list('r1', { status: 'open' }, { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toThrow();
  });

  it('includes fetchedAt when present in list response', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/repos/r1/pull-requests', {
      body: { pullRequests: [{ id: 1 }], total: 1, fetchedAt: 1700000000000 },
    });
    const client = createClient(mock);

    const result = await client.pullRequests.list('r1');
    expect(result.fetchedAt).toBe(1700000000000);
    expect(result.pullRequests).toEqual([{ id: 1 }]);
  });

  it('lists, records, and removes recently opened PRs', async () => {
    mock = await startMockServer();
    const now = new Date('2026-06-03T00:00:00.000Z').toISOString();
    const entry = {
      workspaceId: 'ws-1',
      repoId: 'repo-1',
      number: 42,
      title: 'Add recent list',
      webUrl: 'https://github.com/org/repo/pull/42',
      openedAt: now,
    };
    mock.on('GET', '/api/repos/repo-1/pull-requests/recent-opened', { body: { entries: [entry] } });
    mock.on('POST', '/api/repos/repo-1/pull-requests/recent-opened', { body: { entries: [entry] } });
    mock.on('DELETE', '/api/repos/repo-1/pull-requests/recent-opened/42', { body: { entries: [] } });
    const client = createClient(mock);

    await expect(client.pullRequests.listRecentOpened('repo-1', 'ws-1')).resolves.toEqual({ entries: [entry] });
    await expect(client.pullRequests.recordRecentOpened('repo-1', 'ws-1', {
      number: 42,
      title: 'Add recent list',
      webUrl: 'https://github.com/org/repo/pull/42',
    })).resolves.toEqual({ entries: [entry] });
    await expect(client.pullRequests.removeRecentOpened('repo-1', 'ws-1', 42)).resolves.toEqual({ entries: [] });

    expectEmptyRequest(mock.requests[0], 'GET', '/api/repos/repo-1/pull-requests/recent-opened', { workspaceId: 'ws-1' });
    expectJsonRequest(mock.requests[1], 'POST', '/api/repos/repo-1/pull-requests/recent-opened', {
      workspaceId: 'ws-1',
      number: 42,
      title: 'Add recent list',
      webUrl: 'https://github.com/org/repo/pull/42',
    });
    expectEmptyRequest(mock.requests[2], 'DELETE', '/api/repos/repo-1/pull-requests/recent-opened/42', { workspaceId: 'ws-1' });
  });

  it('lists, records, and removes recently opened PRs by origin', async () => {
    mock = await startMockServer();
    const now = new Date('2026-06-03T00:00:00.000Z').toISOString();
    const entry = {
      workspaceId: 'ws-1',
      repoId: 'repo-1',
      number: 42,
      title: 'Add recent list',
      webUrl: 'https://github.com/org/repo/pull/42',
      openedAt: now,
    };
    mock.on('GET', '/api/origins/gh_owner_repo/pull-requests/recent-opened', { body: { entries: [entry] } });
    mock.on('POST', '/api/origins/gh_owner_repo/pull-requests/recent-opened', { body: { entries: [entry] } });
    mock.on('DELETE', '/api/origins/gh_owner_repo/pull-requests/recent-opened/42', { body: { entries: [] } });
    const client = createClient(mock);

    await expect(client.pullRequests.listRecentOpenedForOrigin('gh_owner_repo', { workspaceId: 'ws-1', repoId: 'repo-1' })).resolves.toEqual({ entries: [entry] });
    await expect(client.pullRequests.recordRecentOpenedForOrigin('gh_owner_repo', {
      number: 42,
      title: 'Add recent list',
      webUrl: 'https://github.com/org/repo/pull/42',
    }, { workspaceId: 'ws-1', repoId: 'repo-1' })).resolves.toEqual({ entries: [entry] });
    await expect(client.pullRequests.removeRecentOpenedForOrigin('gh_owner_repo', 42, { workspaceId: 'ws-1', repoId: 'repo-1' })).resolves.toEqual({ entries: [] });

    expectEmptyRequest(mock.requests[0], 'GET', '/api/origins/gh_owner_repo/pull-requests/recent-opened', { workspaceId: 'ws-1', repoId: 'repo-1' });
    expectJsonRequest(mock.requests[1], 'POST', '/api/origins/gh_owner_repo/pull-requests/recent-opened', {
      workspaceId: 'ws-1',
      repoId: 'repo-1',
      number: 42,
      title: 'Add recent list',
      webUrl: 'https://github.com/org/repo/pull/42',
    });
    expectEmptyRequest(mock.requests[2], 'DELETE', '/api/origins/gh_owner_repo/pull-requests/recent-opened/42', { workspaceId: 'ws-1', repoId: 'repo-1' });
  });

  it('lists, adds, and removes Team coworker roster entries', async () => {
    mock = await startMockServer();
    const now = new Date('2026-06-05T00:00:00.000Z').toISOString();
    const entry = {
      id: '123',
      displayName: 'Mona Dev',
      email: 'mona@example.invalid',
      avatarUrl: 'https://avatars.example.invalid/u/123',
      addedAt: now,
    };
    mock.on('GET', '/api/repos/repo-1/pull-requests/coworker-roster', { body: { entries: [entry] } });
    mock.on('POST', '/api/repos/repo-1/pull-requests/coworker-roster', { body: { entries: [entry] } });
    mock.on('DELETE', '/api/repos/repo-1/pull-requests/coworker-roster/123', { body: { entries: [] } });
    const client = createClient(mock);

    await expect(client.pullRequests.listCoworkerRoster('repo-1', 'ws-1')).resolves.toEqual({ entries: [entry] });
    await expect(client.pullRequests.addCoworkerToRoster('repo-1', 'ws-1', {
      id: '123',
      displayName: 'Mona Dev',
      email: 'mona@example.invalid',
      avatarUrl: 'https://avatars.example.invalid/u/123',
    })).resolves.toEqual({ entries: [entry] });
    await expect(client.pullRequests.removeCoworkerFromRoster('repo-1', 'ws-1', '123')).resolves.toEqual({ entries: [] });

    expectEmptyRequest(mock.requests[0], 'GET', '/api/repos/repo-1/pull-requests/coworker-roster', { workspaceId: 'ws-1' });
    expectJsonRequest(mock.requests[1], 'POST', '/api/repos/repo-1/pull-requests/coworker-roster', {
      workspaceId: 'ws-1',
      id: '123',
      displayName: 'Mona Dev',
      email: 'mona@example.invalid',
      avatarUrl: 'https://avatars.example.invalid/u/123',
    });
    expectEmptyRequest(mock.requests[2], 'DELETE', '/api/repos/repo-1/pull-requests/coworker-roster/123', { workspaceId: 'ws-1' });
  });

  it('lists, adds, and removes Team coworker roster entries by origin', async () => {
    mock = await startMockServer();
    const now = new Date('2026-06-05T00:00:00.000Z').toISOString();
    const entry = {
      id: '123',
      displayName: 'Mona Dev',
      email: 'mona@example.invalid',
      avatarUrl: 'https://avatars.example.invalid/u/123',
      addedAt: now,
    };
    mock.on('GET', '/api/origins/gh_owner_repo/pull-requests/coworker-roster', { body: { entries: [entry] } });
    mock.on('POST', '/api/origins/gh_owner_repo/pull-requests/coworker-roster', { body: { entries: [entry] } });
    mock.on('DELETE', '/api/origins/gh_owner_repo/pull-requests/coworker-roster/123', { body: { entries: [] } });
    const client = createClient(mock);

    await expect(client.pullRequests.listCoworkerRosterForOrigin('gh_owner_repo', { workspaceId: 'ws-1', repoId: 'repo-1' })).resolves.toEqual({ entries: [entry] });
    await expect(client.pullRequests.addCoworkerToRosterForOrigin('gh_owner_repo', {
      id: '123',
      displayName: 'Mona Dev',
      email: 'mona@example.invalid',
      avatarUrl: 'https://avatars.example.invalid/u/123',
    }, { workspaceId: 'ws-1', repoId: 'repo-1' })).resolves.toEqual({ entries: [entry] });
    await expect(client.pullRequests.removeCoworkerFromRosterForOrigin('gh_owner_repo', '123', { workspaceId: 'ws-1', repoId: 'repo-1' })).resolves.toEqual({ entries: [] });

    expectEmptyRequest(mock.requests[0], 'GET', '/api/origins/gh_owner_repo/pull-requests/coworker-roster', { workspaceId: 'ws-1', repoId: 'repo-1' });
    expectJsonRequest(mock.requests[1], 'POST', '/api/origins/gh_owner_repo/pull-requests/coworker-roster', {
      workspaceId: 'ws-1',
      repoId: 'repo-1',
      id: '123',
      displayName: 'Mona Dev',
      email: 'mona@example.invalid',
      avatarUrl: 'https://avatars.example.invalid/u/123',
    });
    expectEmptyRequest(mock.requests[2], 'DELETE', '/api/origins/gh_owner_repo/pull-requests/coworker-roster/123', { workspaceId: 'ws-1', repoId: 'repo-1' });
  });

  it('lists, gets, creates, and deletes pull-request chat bindings', async () => {
    mock = await startMockServer();
    const now = new Date('2026-04-18T00:00:00.000Z').toISOString();
    mock.on('GET', '/api/workspaces/ws-1/pull-request-chat-bindings', {
      body: { bindings: { '142': { taskId: 'task-1', createdAt: now } } },
    });
    mock.on('GET', '/api/workspaces/ws-1/pull-request-chat-bindings/142', {
      body: { prId: '142', taskId: 'task-1' },
    });
    mock.on('POST', '/api/workspaces/ws-1/pull-request-chat-bindings', {
      status: 201,
      body: { prId: '142', taskId: 'task-1' },
    });
    mock.on('DELETE', '/api/workspaces/ws-1/pull-request-chat-bindings/142', {
      status: 204,
      body: undefined,
    });
    mock.on('GET', '/api/origins/gh_owner_repo/pull-request-chat-bindings', {
      body: { bindings: { '142': { taskId: 'task-origin', createdAt: now } } },
    });
    mock.on('GET', '/api/origins/gh_owner_repo/pull-request-chat-bindings/142', {
      body: { prId: '142', taskId: 'task-origin' },
    });
    mock.on('POST', '/api/origins/gh_owner_repo/pull-request-chat-bindings', {
      status: 201,
      body: { prId: '142', taskId: 'task-origin' },
    });
    mock.on('DELETE', '/api/origins/gh_owner_repo/pull-request-chat-bindings/142', {
      status: 204,
      body: undefined,
    });
    const client = createClient(mock);

    await expect(client.pullRequests.listChatBindings('ws-1')).resolves.toEqual({
      bindings: { '142': { taskId: 'task-1', createdAt: now } },
    });
    await expect(client.pullRequests.getChatBinding('ws-1', '142')).resolves.toEqual({
      prId: '142',
      taskId: 'task-1',
    });
    await expect(client.pullRequests.createChatBinding('ws-1', '142', 'task-1')).resolves.toEqual({
      prId: '142',
      taskId: 'task-1',
    });
    await expect(client.pullRequests.deleteChatBinding('ws-1', '142')).resolves.toBeUndefined();
    await expect(client.pullRequests.listChatBindingsForOrigin('gh_owner_repo')).resolves.toEqual({
      bindings: { '142': { taskId: 'task-origin', createdAt: now } },
    });
    await expect(client.pullRequests.getChatBindingForOrigin('gh_owner_repo', '142')).resolves.toEqual({
      prId: '142',
      taskId: 'task-origin',
    });
    await expect(client.pullRequests.createChatBindingForOrigin('gh_owner_repo', '142', 'task-origin')).resolves.toEqual({
      prId: '142',
      taskId: 'task-origin',
    });
    await expect(client.pullRequests.deleteChatBindingForOrigin('gh_owner_repo', '142')).resolves.toBeUndefined();

    expectEmptyRequest(mock.requests[0], 'GET', '/api/workspaces/ws-1/pull-request-chat-bindings');
    expectEmptyRequest(mock.requests[1], 'GET', '/api/workspaces/ws-1/pull-request-chat-bindings/142');
    expectJsonRequest(mock.requests[2], 'POST', '/api/workspaces/ws-1/pull-request-chat-bindings', {
      prId: '142',
      taskId: 'task-1',
    });
    expect(mock.requests[3]).toMatchObject({ method: 'DELETE', path: '/api/workspaces/ws-1/pull-request-chat-bindings/142' });
    expectEmptyRequest(mock.requests[4], 'GET', '/api/origins/gh_owner_repo/pull-request-chat-bindings');
    expectEmptyRequest(mock.requests[5], 'GET', '/api/origins/gh_owner_repo/pull-request-chat-bindings/142');
    expectJsonRequest(mock.requests[6], 'POST', '/api/origins/gh_owner_repo/pull-request-chat-bindings', {
      prId: '142',
      taskId: 'task-origin',
    });
    expect(mock.requests[7]).toMatchObject({ method: 'DELETE', path: '/api/origins/gh_owner_repo/pull-request-chat-bindings/142' });
  });

  it('gets and saves PR review progress by origin', async () => {
    mock = await startMockServer();
    const record = {
      repoId: 'repo-1',
      prId: '42',
      headSha: 'abc123',
      reviewedFiles: ['src/a.ts'],
      visitedFiles: ['src/a.ts', 'src/b.ts'],
      lastSelectedFile: 'src/b.ts',
      updatedAt: '2026-06-05T00:00:00.000Z',
    };
    mock.on('GET', '/api/origins/gh_owner_repo/pull-requests/42/review-progress', { body: record });
    mock.on('PUT', '/api/origins/gh_owner_repo/pull-requests/42/review-progress', { body: record });
    const client = createClient(mock);

    await expect(client.pullRequests.getReviewProgressForOrigin('gh_owner_repo', '42', 'abc123', {
      workspaceId: 'ws-1',
      repoId: 'repo-1',
    })).resolves.toEqual(record);
    await expect(client.pullRequests.saveReviewProgressForOrigin('gh_owner_repo', '42', {
      headSha: 'abc123',
      reviewedFiles: ['src/a.ts'],
      visitedFiles: ['src/a.ts', 'src/b.ts'],
      lastSelectedFile: 'src/b.ts',
    }, {
      workspaceId: 'ws-1',
      repoId: 'repo-1',
    })).resolves.toEqual(record);

    expectEmptyRequest(mock.requests[0], 'GET', '/api/origins/gh_owner_repo/pull-requests/42/review-progress', {
      workspaceId: 'ws-1',
      repoId: 'repo-1',
      headSha: 'abc123',
    });
    expectJsonRequest(mock.requests[1], 'PUT', '/api/origins/gh_owner_repo/pull-requests/42/review-progress', {
      workspaceId: 'ws-1',
      repoId: 'repo-1',
      headSha: 'abc123',
      reviewedFiles: ['src/a.ts'],
      visitedFiles: ['src/a.ts', 'src/b.ts'],
      lastSelectedFile: 'src/b.ts',
    });
  });

  it('uses origin routes for PR suggestions and Team classification state', async () => {
    mock = await startMockServer();
    const client = createClient(mock);
    mock.on('GET', '/api/origins/gh_owner_repo/pull-requests/suggestions', { body: { suggestions: [], rankedAt: null } });
    mock.on('POST', '/api/origins/gh_owner_repo/pull-requests/review-history/refresh', { body: { reviews: [], fetchedAt: '2026-01-01T00:00:00.000Z' } });
    mock.on('POST', '/api/origins/gh_owner_repo/pull-requests/suggestions/refresh', { body: { suggestions: [{ prNumber: 42, score: 90 }], rankedAt: '2026-01-01T00:01:00.000Z' } });
    mock.on('GET', '/api/origins/gh_owner_repo/classify-diff/batch-status', { body: { statuses: { '42:abc123': 'ready' } } });
    mock.on('POST', '/api/origins/gh_owner_repo/pull-requests/team-auto-classification', { body: { eligible: 1, considered: 1, skippedMissingHeadSha: 0, skippedMissingNumber: 0, ready: 0, running: 0, started: 1, notFound: 0, errors: [] } });

    await expect(client.pullRequests.getSuggestionsForOrigin('gh_owner_repo', { workspaceId: 'ws-1', repoId: 'repo-1' })).resolves.toEqual({ suggestions: [], rankedAt: null });
    await expect(client.pullRequests.refreshReviewHistoryForOrigin('gh_owner_repo', { workspaceId: 'ws-1', repoId: 'repo-1' })).resolves.toEqual({ reviews: [], fetchedAt: '2026-01-01T00:00:00.000Z' });
    await expect(client.pullRequests.refreshSuggestionsForOrigin('gh_owner_repo', { workspaceId: 'ws-1', repoId: 'repo-1' })).resolves.toEqual({ suggestions: [{ prNumber: 42, score: 90 }], rankedAt: '2026-01-01T00:01:00.000Z' });
    await expect(client.pullRequests.getClassificationBatchStatusForOrigin('gh_owner_repo', {
      type: 'pr',
      identifiers: ['42:abc123'],
      workspaceId: 'ws-1',
      repoId: 'repo-1',
    })).resolves.toEqual({ statuses: { '42:abc123': 'ready' } });
    await expect(client.pullRequests.autoClassifyTeamForOrigin('gh_owner_repo', {
      pullRequests: [{ number: 42, status: 'open', headSha: 'abc123', title: 'PR 42' }],
    }, {
      workspaceId: 'ws-1',
      repoId: 'repo-1',
    })).resolves.toMatchObject({ started: 1 });

    expectEmptyRequest(mock.requests[0], 'GET', '/api/origins/gh_owner_repo/pull-requests/suggestions', {
      workspaceId: 'ws-1',
      repoId: 'repo-1',
    });
    expectEmptyRequest(mock.requests[1], 'POST', '/api/origins/gh_owner_repo/pull-requests/review-history/refresh', {
      workspaceId: 'ws-1',
      repoId: 'repo-1',
    });
    expectEmptyRequest(mock.requests[2], 'POST', '/api/origins/gh_owner_repo/pull-requests/suggestions/refresh', {
      workspaceId: 'ws-1',
      repoId: 'repo-1',
    });
    expectEmptyRequest(mock.requests[3], 'GET', '/api/origins/gh_owner_repo/classify-diff/batch-status', {
      type: 'pr',
      identifiers: '42:abc123',
      workspaceId: 'ws-1',
      repoId: 'repo-1',
    });
    expectJsonRequest(mock.requests[4], 'POST', '/api/origins/gh_owner_repo/pull-requests/team-auto-classification', {
      workspaceId: 'ws-1',
      repoId: 'repo-1',
      pullRequests: [{ number: 42, status: 'open', headSha: 'abc123', title: 'PR 42' }],
    });
  });
});

function createClient(mock: MockServer): CocClient {
  return new CocClient({ baseUrl: mock.url, fetch: globalThis.fetch });
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

function expectJsonRequest(
  request: RecordedRequest,
  method: string,
  path: string,
  body: unknown,
): void {
  expect(request).toMatchObject({
    method,
    path,
    query: {},
    rawBody: JSON.stringify(body),
    body,
  });
  expect(request.headers['content-type']).toBe('application/json');
}
