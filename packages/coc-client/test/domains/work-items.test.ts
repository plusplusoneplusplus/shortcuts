import { describe, expect, it } from 'vitest';
import { WorkItemsClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('WorkItemsClient', () => {
  it('encodes workspace and work item IDs in path segments', async () => {
    const adapter = createMockAdapter({});
    const client = new WorkItemsClient(adapter);

    await client.list('repo/a', { status: ['created', 'planning'], tags: ['x', 'y'] });
    await client.create('repo/a', { title: 'Task', description: 'Do it', priority: 'normal' });
    await client.updatePlan('repo/a', 'wi/1', 'plan');
    await client.execute('repo/a', 'wi/1', { model: 'm' });
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
      path: '/workspaces/repo%2Fa/work-items/wi%2F1/execute',
      options: { method: 'POST', body: { model: 'm' } },
    });
    expect(adapter.calls[4]).toMatchObject({
      path: '/workspaces/repo%2Fa/work-items/wi%2F1/resolve-comments',
      options: { method: 'POST', body: { type: 'commit', commitSha: 'abc123' } },
    });
    expect(adapter.calls[5]).toEqual({
      path: '/workspaces/repo%2Fa/work-item-chat-bindings',
      options: undefined,
    });
    expect(adapter.calls[6]).toEqual({
      path: '/workspaces/repo%2Fa/work-item-chat-bindings/wi%2F1',
      options: undefined,
    });
    expect(adapter.calls[7]).toEqual({
      path: '/workspaces/repo%2Fa/work-item-chat-bindings',
      options: { method: 'POST', body: { workItemId: 'wi/1', taskId: 'task/1' } },
    });
    expect(adapter.calls[8]).toEqual({
      path: '/workspaces/repo%2Fa/work-item-chat-bindings/wi%2F1',
      options: { method: 'DELETE' },
    });
  });
});
