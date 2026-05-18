import { describe, expect, it } from 'vitest';
import { PullRequestsClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('PullRequestsClient', () => {
  it('calls provider config endpoints with exact method, path, and body shapes', async () => {
    const adapter = createMockAdapter({ providers: {} });
    const client = new PullRequestsClient(adapter);

    await client.getProviderConfig();
    await client.saveProviderConfig({ github: { token: 'ghp_token' } });
    await client.saveProviderConfig({ ado: { orgUrl: 'https://dev.azure.com/org', token: 'ado-token' } });
    await client.saveProviderConfig({ tavily: { apiKey: 'tvly-key' } });

    expect(adapter.calls).toEqual([
      {
        path: '/providers/config',
        options: undefined,
      },
      {
        path: '/providers/config',
        options: {
          method: 'PUT',
          body: { github: { token: 'ghp_token' } },
        },
      },
      {
        path: '/providers/config',
        options: {
          method: 'PUT',
          body: { ado: { orgUrl: 'https://dev.azure.com/org', token: 'ado-token' } },
        },
      },
      {
        path: '/providers/config',
        options: {
          method: 'PUT',
          body: { tavily: { apiKey: 'tvly-key' } },
        },
      },
    ]);
  });

  it('lists, gets, and queries PR data with encoded repo and PR IDs', async () => {
    const adapter = createMockAdapter({});
    const client = new PullRequestsClient(adapter);

    await client.list('repo/a', { status: 'open', scope: 'all', top: 10, skip: 5, force: true, author: 'me', search: 'fix' });
    await client.get('repo/a', 'pr/1');
    await client.getThreads('repo/a', 'pr/1');
    await client.getReviewers('repo/a', 'pr/1');
    await client.getCommits('repo/a', 'pr/1');
    await client.getDiff('repo/a', 'pr/1');
    await client.getCommits('repo/a', 'pr/1');

    expect(adapter.calls).toMatchObject([
      {
        path: '/repos/repo%2Fa/pull-requests',
        options: { query: { status: 'open', scope: 'all', top: 10, skip: 5, force: 'true', author: 'me', search: 'fix' } },
      },
      { path: '/repos/repo%2Fa/pull-requests/pr%2F1' },
      { path: '/repos/repo%2Fa/pull-requests/pr%2F1/threads' },
      { path: '/repos/repo%2Fa/pull-requests/pr%2F1/reviewers' },
      { path: '/repos/repo%2Fa/pull-requests/pr%2F1/commits' },
      { path: '/repos/repo%2Fa/pull-requests/pr%2F1/diff' },
      { path: '/repos/repo%2Fa/pull-requests/pr%2F1/commits' },
    ]);
  });

  it('omits force query param when not true', async () => {
    const adapter = createMockAdapter({});
    const client = new PullRequestsClient(adapter);

    await client.list('repo-a', { status: 'closed' });
    await client.list('repo-a');

    expect(adapter.calls[0].options).toMatchObject({ query: { status: 'closed' } });
    expect(adapter.calls[0].options?.query?.force).toBeUndefined();
    expect(adapter.calls[1].options).toMatchObject({ query: undefined });
  });

  it('forwards abort signal to all data methods', async () => {
    const adapter = createMockAdapter({});
    const client = new PullRequestsClient(adapter);
    const controller = new AbortController();

    await client.list('r1', { status: 'open' }, { signal: controller.signal });
    await client.get('r1', '10', { signal: controller.signal });
    await client.getThreads('r1', '10', { signal: controller.signal });
    await client.getReviewers('r1', '10', { signal: controller.signal });
    await client.getCommits('r1', '10', { signal: controller.signal });
    await client.getDiff('r1', '10', { signal: controller.signal });
    await client.getCommits('r1', '10', { signal: controller.signal });

    for (const call of adapter.calls) {
      expect(call.options?.signal).toBe(controller.signal);
    }
  });

  it('does not pass signal when options are omitted', async () => {
    const adapter = createMockAdapter({});
    const client = new PullRequestsClient(adapter);

    await client.list('r1');
    await client.get('r1', '1');
    await client.getThreads('r1', '1');
    await client.getReviewers('r1', '1');
    await client.getCommits('r1', '1');
    await client.getDiff('r1', '1');
    await client.getCommits('r1', '1');

    for (const call of adapter.calls) {
      expect(call.options?.signal).toBeUndefined();
    }
  });

  it('exposes CRUD methods for pull-request chat bindings', async () => {
    const adapter = createMockAdapter({ bindings: {} });
    const client = new PullRequestsClient(adapter);

    await client.listChatBindings('ws/a');
    await client.getChatBinding('ws/a', '142');
    await client.createChatBinding('ws/a', '142', 'task-1');
    await client.deleteChatBinding('ws/a', '142');

    expect(adapter.calls).toEqual([
      { path: '/workspaces/ws%2Fa/pull-request-chat-bindings', options: undefined },
      { path: '/workspaces/ws%2Fa/pull-request-chat-bindings/142', options: undefined },
      {
        path: '/workspaces/ws%2Fa/pull-request-chat-bindings',
        options: { method: 'POST', body: { prId: '142', taskId: 'task-1' } },
      },
      {
        path: '/workspaces/ws%2Fa/pull-request-chat-bindings/142',
        options: { method: 'DELETE' },
      },
    ]);
  });

  it('classify sends POST with headSha, model, and encoded IDs', async () => {
    const adapter = createMockAdapter({ status: 'started', taskId: 'task-1' });
    const client = new PullRequestsClient(adapter);

    await client.classify('repo/a', 'pr/1', { headSha: 'abc123', model: 'haiku' });

    expect(adapter.calls).toEqual([
      {
        path: '/repos/repo%2Fa/pull-requests/pr%2F1/classify',
        options: {
          method: 'POST',
          body: { headSha: 'abc123', model: 'haiku' },
          signal: undefined,
        },
      },
    ]);
  });

  it('classify forwards abort signal', async () => {
    const adapter = createMockAdapter({ status: 'started' });
    const client = new PullRequestsClient(adapter);
    const controller = new AbortController();

    await client.classify('r1', '10', { headSha: 'sha1' }, { signal: controller.signal });

    expect(adapter.calls[0].options?.signal).toBe(controller.signal);
  });

  it('getClassification sends GET with headSha query param', async () => {
    const adapter = createMockAdapter({ status: 'none' });
    const client = new PullRequestsClient(adapter);

    await client.getClassification('repo/a', 'pr/1', 'abc123');

    expect(adapter.calls).toEqual([
      {
        path: '/repos/repo%2Fa/pull-requests/pr%2F1/classification',
        options: {
          query: { headSha: 'abc123' },
          signal: undefined,
        },
      },
    ]);
  });

  it('getClassification forwards abort signal', async () => {
    const adapter = createMockAdapter({ status: 'ready' });
    const client = new PullRequestsClient(adapter);
    const controller = new AbortController();

    await client.getClassification('r1', '10', 'sha1', { signal: controller.signal });

    expect(adapter.calls[0].options?.signal).toBe(controller.signal);
  });

  it('prFileDiffPath returns encoded per-file diff path', () => {
    const adapter = createMockAdapter({});
    const client = new PullRequestsClient(adapter);

    expect(client.prFileDiffPath('repo/a', 'pr/1', 'src/foo.ts')).toBe(
      '/api/repos/repo%2Fa/pull-requests/pr%2F1/diff/files/src%2Ffoo.ts',
    );
  });
});
