import { describe, expect, it, vi } from 'vitest';
import { CocClient, WorkItemsClient, type WorkItem } from '../../src';
import { createMockAdapter } from './helpers';

const workItem: WorkItem = {
  id: 'wi-1',
  repoId: 'repo/a',
  title: 'Task',
  description: 'Do it',
  status: 'created',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

class RecordingWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static constructedUrls: string[] = [];

  readonly readyState = RecordingWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    RecordingWebSocket.constructedUrls.push(url);
  }

  send(_data: string): void {}

  close(_code?: number, _reason?: string): void {}
}

describe('WorkItemsClient mock coverage', () => {
  it('serializes list filters and grouped filters with once-encoded workspace IDs', async () => {
    const adapter = createMockAdapter({ items: [], total: 0, hasMore: false });
    const client = new WorkItemsClient(adapter);

    await client.list('repo/a', {
      status: ['created', 'planning'],
      priority: 'high',
      tags: ['frontend', 'triage'],
      tracker: 'github-backed',
      q: 'login bug',
      limit: 25,
      offset: 50,
    });
    await client.grouped('repo/a', {
      source: 'manual',
      priority: 'low',
      tags: ['backend', 'urgent'],
      type: 'bug',
      tracker: 'local-only',
      q: 'crash',
      limit: 5,
    });
    await client.tree('repo/a', {
      q: 'epic',
      tracker: 'github-backed',
      includeDone: true,
    });

    expect(adapter.calls[0]).toEqual({
      path: '/workspaces/repo%2Fa/work-items',
      options: {
        query: {
          status: 'created,planning',
          priority: 'high',
          tags: 'frontend,triage',
          tracker: 'github-backed',
          q: 'login bug',
          limit: 25,
          offset: 50,
        },
      },
    });
    expect(adapter.calls[1]).toEqual({
      path: '/workspaces/repo%2Fa/work-items/grouped',
      options: {
        query: {
          source: 'manual',
          priority: 'low',
          tags: 'backend,urgent',
          type: 'bug',
          tracker: 'local-only',
          q: 'crash',
          limit: 5,
        },
      },
    });
    expect(adapter.calls[2]).toEqual({
      path: '/workspaces/repo%2Fa/work-items/tree',
      options: {
        query: {
          q: 'epic',
          tracker: 'github-backed',
          includeDone: true,
        },
      },
    });
  });

  it('sends CRUD requests with exact method, path, and body shapes', async () => {
    const adapter = createMockAdapter(workItem);
    const client = new WorkItemsClient(adapter);

    await client.create('repo/a', {
      title: 'Task',
      description: 'Do it',
      priority: 'normal',
      tags: ['x', 'y'],
      source: 'chat',
    });
    await client.get('repo/a', 'wi/1');
    await client.update('repo/a', 'wi/1', { status: 'planning', tags: ['ready'] });
    await client.delete('repo/a', 'wi/1');

    expect(adapter.calls).toEqual([
      {
        path: '/workspaces/repo%2Fa/work-items',
        options: {
          method: 'POST',
          body: {
            title: 'Task',
            description: 'Do it',
            priority: 'normal',
            tags: ['x', 'y'],
            source: 'chat',
          },
        },
      },
      {
        path: '/workspaces/repo%2Fa/work-items/wi%2F1',
        options: undefined,
      },
      {
        path: '/workspaces/repo%2Fa/work-items/wi%2F1',
        options: {
          method: 'PATCH',
          body: { status: 'planning', tags: ['ready'] },
        },
      },
      {
        path: '/workspaces/repo%2Fa/work-items/wi%2F1',
        options: { method: 'DELETE' },
      },
    ]);
  });

  it('passes epic-rooted tracker metadata through create and update requests', async () => {
    const adapter = createMockAdapter(workItem);
    const client = new WorkItemsClient(adapter);
    const tracker: WorkItem['tracker'] = {
      kind: 'github-backed',
      provider: 'github',
      github: {
        issueNumber: 42,
        issueUrl: 'https://github.com/org/repo/issues/42',
        lastPulledAt: '2026-01-02T00:00:00.000Z',
      },
    };

    await client.create('repo/a', { title: 'Epic', type: 'epic', tracker });
    await client.update('repo/a', 'wi/1', { tracker: { kind: 'local-only' } });

    expect(adapter.calls).toEqual([
      {
        path: '/workspaces/repo%2Fa/work-items',
        options: {
          method: 'POST',
          body: { title: 'Epic', type: 'epic', tracker },
        },
      },
      {
        path: '/workspaces/repo%2Fa/work-items/wi%2F1',
        options: {
          method: 'PATCH',
          body: { tracker: { kind: 'local-only' } },
        },
      },
    ]);
  });

  it('sends secondary mutation requests with exact method, path, and body shapes', async () => {
    const adapter = createMockAdapter(workItem);
    const client = new WorkItemsClient(adapter);

    await client.createFromChat('repo/a', { processId: 'proc/1', extractPlan: true });
    await client.updateStatus('repo/a', 'wi/1', 'done', { completedAt: '2026-01-02T00:00:00.000Z' });
    await client.pin('repo/a', 'wi/1', true);
    await client.archive('repo/a', 'wi/1', false);
    await client.requestChanges('repo/a', 'wi/1', { comments: ['Fix this'], source: 'diff-comments' });

    expect(adapter.calls).toEqual([
      {
        path: '/workspaces/repo%2Fa/work-items/from-chat',
        options: {
          method: 'POST',
          body: { processId: 'proc/1', extractPlan: true },
        },
      },
      {
        path: '/workspaces/repo%2Fa/work-items/wi%2F1',
        options: {
          method: 'PATCH',
          body: { status: 'done', completedAt: '2026-01-02T00:00:00.000Z' },
        },
      },
      {
        path: '/workspaces/repo%2Fa/work-items/wi%2F1/pin',
        options: {
          method: 'PATCH',
          body: { pinned: true },
        },
      },
      {
        path: '/workspaces/repo%2Fa/work-items/wi%2F1/archive',
        options: {
          method: 'PATCH',
          body: { archived: false },
        },
      },
      {
        path: '/workspaces/repo%2Fa/work-items/wi%2F1/request-changes',
        options: {
          method: 'POST',
          body: { comments: ['Fix this'], source: 'diff-comments' },
        },
      },
    ]);
  });

  it('sets JSON content type for create without opening a WebSocket', async () => {
    RecordingWebSocket.constructedUrls = [];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(workItem));
    const client = new CocClient({
      baseUrl: 'http://localhost:4000',
      fetch: fetchMock as typeof fetch,
      WebSocket: RecordingWebSocket,
    });

    await client.workItems.create('repo/a', {
      title: 'Task',
      description: 'Do it',
      priority: 'normal',
      tags: ['x', 'y'],
      source: 'manual',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/workspaces/repo%2Fa/work-items',
      expect.objectContaining({ method: 'POST' }),
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({
      title: 'Task',
      description: 'Do it',
      priority: 'normal',
      tags: ['x', 'y'],
      source: 'manual',
    }));
    expect((init.headers as Headers).get('content-type')).toBe('application/json');
    expect(RecordingWebSocket.constructedUrls).toEqual([]);
  });

  it('propagates CocApiError for get 404 responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      { error: { message: 'Work item not found', code: 'NOT_FOUND' } },
      { status: 404, statusText: 'Not Found' },
    ));
    const client = new CocClient({ baseUrl: 'http://localhost:4000', fetch: fetchMock as typeof fetch });

    await expect(client.workItems.get('repo/a', 'missing/1')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
      code: 'NOT_FOUND',
      message: 'Work item not found',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/workspaces/repo%2Fa/work-items/missing%2F1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns undefined for delete 204 responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new CocClient({ fetch: fetchMock as typeof fetch });

    await expect(client.workItems.delete('repo/a', 'wi/1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/repo%2Fa/work-items/wi%2F1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('handles plan reads and JSON-wrapped plan updates', async () => {
    const markdown = '# Plan\n\n- [ ] Implement it';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        plan: { version: 1, content: markdown, resolvedBy: 'user' },
        versions: 1,
      }))
      .mockResolvedValueOnce(jsonResponse({
        plan: { version: 2, content: markdown, resolvedBy: 'user' },
        version: 2,
      }));
    const client = new CocClient({ baseUrl: 'http://localhost:4000', fetch: fetchMock as typeof fetch });

    await expect(client.workItems.getPlan('repo/a', 'wi/1')).resolves.toEqual({
      plan: { version: 1, content: markdown, resolvedBy: 'user' },
      versions: 1,
    });
    await expect(client.workItems.updatePlan('repo/a', 'wi/1', markdown, {
      resolvedBy: 'user',
      summary: 'Initial plan',
    })).resolves.toEqual({
      plan: { version: 2, content: markdown, resolvedBy: 'user' },
      version: 2,
    });

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:4000/api/workspaces/repo%2Fa/work-items/wi%2F1/plan');
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'GET' }));

    const updateInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:4000/api/workspaces/repo%2Fa/work-items/wi%2F1/plan');
    expect(updateInit.method).toBe('PUT');
    expect(updateInit.body).toBe(JSON.stringify({
      content: markdown,
      resolvedBy: 'user',
      summary: 'Initial plan',
    }));
    expect((updateInit.headers as Headers).get('content-type')).toBe('application/json');
  });

  it('sends plan version lookup, refinement, and resolve-comments payloads', async () => {
    const adapter = createMockAdapter({ taskId: 'task-1' });
    const client = new WorkItemsClient(adapter);

    await client.planVersions('repo/a', 'wi/1');
    await client.getPlanVersion('repo/a', 'wi/1', 3);
    await client.comparePlanVersions('repo/a', 'wi/1', 1, 3);
    await client.restorePlanVersion('repo/a', 'wi/1', 1, { reason: 'Restore v1' });
    await client.refinePlan('repo/a', 'wi/1', { instructions: 'Tighten scope', summary: 'Refine' });
    await client.resolveComments('repo/a', 'wi/1', { type: 'commit', commitSha: 'abc123', sourceRunIndex: 2, model: 'gpt-5.5' });

    expect(adapter.calls).toEqual([
      {
        path: '/workspaces/repo%2Fa/work-items/wi%2F1/plan/versions',
        options: undefined,
      },
      {
        path: '/workspaces/repo%2Fa/work-items/wi%2F1/plan/versions/3',
        options: undefined,
      },
      {
        path: '/workspaces/repo%2Fa/work-items/wi%2F1/plan/versions/compare',
        options: {
          query: { base: 1, target: 3 },
        },
      },
      {
        path: '/workspaces/repo%2Fa/work-items/wi%2F1/plan/versions/1/restore',
        options: {
          method: 'POST',
          body: { reason: 'Restore v1' },
        },
      },
      {
        path: '/workspaces/repo%2Fa/work-items/wi%2F1/plan/refine',
        options: {
          method: 'POST',
          body: { instructions: 'Tighten scope', summary: 'Refine' },
        },
      },
      {
        path: '/workspaces/repo%2Fa/work-items/wi%2F1/resolve-comments',
        options: {
          method: 'POST',
          body: { type: 'commit', commitSha: 'abc123', sourceRunIndex: 2, model: 'gpt-5.5' },
        },
      },
    ]);
  });

  it('propagates CocApiError for locked plan conflicts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      { error: { message: 'Plan is locked', code: 'PLAN_LOCKED' } },
      { status: 409, statusText: 'Conflict' },
    ));
    const client = new CocClient({ fetch: fetchMock as typeof fetch });

    await expect(client.workItems.updatePlan('repo/a', 'wi/1', '# Plan')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 409,
      code: 'PLAN_LOCKED',
      message: 'Plan is locked',
    });
  });

  it('sends execute payloads and returns the process envelope', async () => {
    const adapter = createMockAdapter({ processId: 'proc-1' });
    const client = new WorkItemsClient(adapter);

    await expect(client.execute('repo/a', 'wi/1', {
      model: 'gpt-5.5',
      mode: 'impl',
      skillNames: ['impl'],
      parallelism: 2,
    })).resolves.toEqual({ processId: 'proc-1' });

    expect(adapter.calls[0]).toEqual({
      path: '/workspaces/repo%2Fa/work-items/wi%2F1/execute',
      options: {
        method: 'POST',
        body: {
          model: 'gpt-5.5',
          mode: 'impl',
          skillNames: ['impl'],
          parallelism: 2,
        },
      },
    });
  });

  it('sends Work Item chat binding requests to workspace-scoped endpoints', async () => {
    const adapter = createMockAdapter({ bindings: {} });
    const client = new WorkItemsClient(adapter);

    await client.listChatBindings('repo/a');
    await client.getChatBinding('repo/a', 'wi/1');
    await client.createChatBinding('repo/a', 'wi/1', 'task/1');
    await client.deleteChatBinding('repo/a', 'wi/1');

    expect(adapter.calls).toEqual([
      {
        path: '/workspaces/repo%2Fa/work-item-chat-bindings',
        options: undefined,
      },
      {
        path: '/workspaces/repo%2Fa/work-item-chat-bindings/wi%2F1',
        options: undefined,
      },
      {
        path: '/workspaces/repo%2Fa/work-item-chat-bindings',
        options: {
          method: 'POST',
          body: { workItemId: 'wi/1', taskId: 'task/1' },
        },
      },
      {
        path: '/workspaces/repo%2Fa/work-item-chat-bindings/wi%2F1',
        options: { method: 'DELETE' },
      },
    ]);
  });

  it('sends sync status, import, and conversion requests to workspace-scoped endpoints', async () => {
    const adapter = createMockAdapter({ provider: 'github' });
    const client = new WorkItemsClient(adapter);

    await client.syncStatus('repo/a', 'azure-boards');
    await client.importFromGitHub('repo/a', { issueUrl: 'https://github.com/org/repo/issues/42' });
    await client.importFromGitHub('repo/a', { issueNumber: 42 });
    await client.convertLocalEpicToGitHub('repo/a', 'epic/1');
    await client.convertGitHubEpicToLocal('repo/a', 'epic/1');

    expect(adapter.calls).toEqual([
      {
        path: '/workspaces/repo%2Fa/work-items/sync/status',
        options: { query: { provider: 'azure-boards' } },
      },
      {
        path: '/workspaces/repo%2Fa/work-items/import-from-github',
        options: {
          method: 'POST',
          body: { issueUrl: 'https://github.com/org/repo/issues/42' },
        },
      },
      {
        path: '/workspaces/repo%2Fa/work-items/import-from-github',
        options: {
          method: 'POST',
          body: { issueNumber: 42 },
        },
      },
      {
        path: '/workspaces/repo%2Fa/work-items/epic%2F1/convert-to-github',
        options: { method: 'POST' },
      },
      {
        path: '/workspaces/repo%2Fa/work-items/epic%2F1/convert-to-local',
        options: { method: 'POST' },
      },
    ]);
  });
});
