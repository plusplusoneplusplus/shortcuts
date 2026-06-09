import { describe, expect, it } from 'vitest';
import { WorkItemsClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('WorkItemsClient', () => {
  it('encodes workspace and work item IDs in path segments', async () => {
    const adapter = createMockAdapter({});
    const client = new WorkItemsClient(adapter);
    const controller = new AbortController();

    await client.list('repo/a', { status: ['created', 'planning'], tags: ['x', 'y'] });
    await client.create('repo/a', { title: 'Task', description: 'Do it', priority: 'normal' });
    await client.updatePlan('repo/a', 'wi/1', 'plan');
    await client.comparePlanVersions('repo/a', 'wi/1', 1, 2);
    await client.restorePlanVersion('repo/a', 'wi/1', 1, { summary: 'Restore v1' });
    await client.applyAiDraft(
      'repo/a',
      'wi/1',
      { prompt: 'Draft it', baseUpdatedAt: '2026-01-01T00:00:00.000Z', baseContentVersion: null },
      { signal: controller.signal },
    );
    await client.execute('repo/a', 'wi/1', { model: 'm', executionMode: 'ralph' });
    await client.resolveComments('repo/a', 'wi/1', { type: 'commit', commitSha: 'abc123' });
    await client.listChatBindings('repo/a');
    await client.getChatBinding('repo/a', 'wi/1');
    await client.createChatBinding('repo/a', 'wi/1', 'task/1');
    await client.deleteChatBinding('repo/a', 'wi/1');

    expect(adapter.calls[0]).toMatchObject({
      path: '/workspaces/repo%2Fa/work-items',
      options: { query: { status: 'created,planning', tags: 'x,y' } },
    });
    expect(adapter.calls[2].path).toBe('/workspaces/repo%2Fa/work-items/wi%2F1/plan');
    expect(adapter.calls[3]).toMatchObject({
      path: '/workspaces/repo%2Fa/work-items/wi%2F1/plan/versions/compare',
      options: { query: { base: 1, target: 2 } },
    });
    expect(adapter.calls[4]).toMatchObject({
      path: '/workspaces/repo%2Fa/work-items/wi%2F1/plan/versions/1/restore',
      options: { method: 'POST', body: { summary: 'Restore v1' } },
    });
    expect(adapter.calls[5]).toMatchObject({
      path: '/workspaces/repo%2Fa/work-items/wi%2F1/ai-draft/apply',
      options: {
        method: 'POST',
        body: { prompt: 'Draft it', baseUpdatedAt: '2026-01-01T00:00:00.000Z', baseContentVersion: null },
        signal: controller.signal,
      },
    });
    expect(adapter.calls[6]).toMatchObject({
      path: '/workspaces/repo%2Fa/work-items/wi%2F1/execute',
      options: { method: 'POST', body: { model: 'm', executionMode: 'ralph' } },
    });
    expect(adapter.calls[7]).toMatchObject({
      path: '/workspaces/repo%2Fa/work-items/wi%2F1/resolve-comments',
      options: { method: 'POST', body: { type: 'commit', commitSha: 'abc123' } },
    });
    expect(adapter.calls[8]).toEqual({
      path: '/workspaces/repo%2Fa/work-item-chat-bindings',
      options: undefined,
    });
    expect(adapter.calls[9]).toEqual({
      path: '/workspaces/repo%2Fa/work-item-chat-bindings/wi%2F1',
      options: undefined,
    });
    expect(adapter.calls[10]).toEqual({
      path: '/workspaces/repo%2Fa/work-item-chat-bindings',
      options: { method: 'POST', body: { workItemId: 'wi/1', taskId: 'task/1' } },
    });
    expect(adapter.calls[11]).toEqual({
      path: '/workspaces/repo%2Fa/work-item-chat-bindings/wi%2F1',
      options: { method: 'DELETE' },
    });
  });
});
