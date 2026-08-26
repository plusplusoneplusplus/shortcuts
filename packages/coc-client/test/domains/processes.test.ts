import { describe, expect, it } from 'vitest';
import { CocClient, ProcessesClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('ProcessesClient', () => {
  it('serializes list filters and gets process details', async () => {
    const adapter = createMockAdapter({ processes: [] });
    const client = new ProcessesClient(adapter, new CocClient({ fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch }).options);

    await client.list({ workspace: 'repo/a', status: ['running', 'queued'], exclude: ['conversation', 'toolCalls'], limit: 5 });
    await client.search({ q: 'needle', workspace: 'repo/a', status: 'completed', type: 'chat', limit: 10 });
    await client.get('proc/1', { workspace: 'repo/a' });
    await client.pinTurn('proc/1', 3, true);
    await client.archiveTurn('proc/1', 3, false);
    await client.pinnedTurns('proc/1');
    await client.listGroupPins('repo/a');
    await client.pinGroup('repo/a', 'ralph-session', 'ralph/1', true);
    await client.resumeCli('proc/1');
    await client.fork('proc/1', { workspace: 'repo/a' });
    await client.rewindTurn('proc/1', 3, { workspace: 'repo/a' });

    expect(adapter.calls[0]).toMatchObject({
      path: '/processes',
      options: { query: { workspace: 'repo/a', status: 'running,queued', exclude: 'conversation,toolCalls', limit: 5 } },
    });
    expect(adapter.calls[1]).toMatchObject({
      path: '/processes/search',
      options: { query: { q: 'needle', workspace: 'repo/a', status: 'completed', type: 'chat', limit: 10 } },
    });
    expect(adapter.calls[2].path).toBe('/processes/proc%2F1');
    expect(adapter.calls.slice(3).map(c => c.path)).toEqual([
      '/processes/proc%2F1/turns/3/pin',
      '/processes/proc%2F1/turns/3/archive',
      '/processes/proc%2F1/turns/pinned',
      '/workspaces/repo%2Fa/group-pins',
      '/workspaces/repo%2Fa/group-pins/ralph-session/ralph%2F1',
      '/processes/proc%2F1/resume-cli',
      '/processes/proc%2F1/fork',
      '/processes/proc%2F1/turns/3/rewind',
    ]);
    expect(adapter.calls[3].options).toMatchObject({ method: 'PATCH', body: { pinned: true } });
    expect(adapter.calls[4].options).toMatchObject({ method: 'PATCH', body: { archived: false } });
    expect(adapter.calls[7].options).toMatchObject({ method: 'PATCH', body: { pinned: true } });
    expect(adapter.calls[9].options).toMatchObject({ method: 'POST', query: { workspace: 'repo/a' }, body: {} });
    expect(adapter.calls[10].options).toMatchObject({ method: 'POST', query: { workspace: 'repo/a' }, body: {} });
  });

  it('serializes chat-folder CRUD and membership requests', async () => {
    const adapter = createMockAdapter({});
    const client = new ProcessesClient(adapter, new CocClient({ fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch }).options);

    await client.listChatFolders('repo/a');
    await client.createChatFolder('repo/a', { name: 'Auth rewrite', color: 'purple' });
    await client.updateChatFolder('repo/a', 'folder/1', { name: 'Auth', sortIndex: 2 });
    await client.deleteChatFolder('repo/a', 'folder/1');
    await client.setProcessFolder('proc/1', 'folder/1');
    await client.setProcessFolder('proc/1', null);
    await client.setProcessFolderBatch(['p1', 'p2'], 'folder/1');

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/workspaces/repo%2Fa/chat-folders',
      '/workspaces/repo%2Fa/chat-folders',
      '/workspaces/repo%2Fa/chat-folders/folder%2F1',
      '/workspaces/repo%2Fa/chat-folders/folder%2F1',
      '/processes/proc%2F1/folder',
      '/processes/proc%2F1/folder',
      '/processes/folder',
    ]);
    expect(adapter.calls[0].options?.method ?? 'GET').toBe('GET');
    expect(adapter.calls[1].options).toMatchObject({ method: 'POST', body: { name: 'Auth rewrite', color: 'purple' } });
    expect(adapter.calls[2].options).toMatchObject({ method: 'PATCH', body: { name: 'Auth', sortIndex: 2 } });
    expect(adapter.calls[3].options).toMatchObject({ method: 'DELETE' });
    expect(adapter.calls[4].options).toMatchObject({ method: 'PATCH', body: { folderId: 'folder/1' } });
    expect(adapter.calls[5].options).toMatchObject({ method: 'PATCH', body: { folderId: null } });
    expect(adapter.calls[6].options).toMatchObject({ method: 'POST', body: { ids: ['p1', 'p2'], folderId: 'folder/1' } });
  });

  it('encodes process IDs once in detail paths and stream URLs', async () => {
    const adapter = createMockAdapter({});
    const client = new ProcessesClient(adapter, new CocClient({
      baseUrl: 'http://localhost:4000',
      fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch,
    }).options);

    await client.get('proc/1 snow/雪%done');

    expect(adapter.calls[0].path).toBe('/processes/proc%2F1%20snow%2F%E9%9B%AA%25done');
    expect(client.streamUrl('proc/1', { workspace: 'repo/a' }))
      .toBe('http://localhost:4000/api/processes/proc%2F1/stream?workspace=repo%2Fa');
  });

  it('sends follow-up messages to the server-authoritative message endpoint', async () => {
    const adapter = createMockAdapter({ queued: true });
    const client = new ProcessesClient(adapter, new CocClient({ fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch }).options);

    await client.sendMessage('p1', { content: 'hello', deliveryMode: 'enqueue' }, { workspace: 'repo/a' });

    expect(adapter.calls[0]).toMatchObject({
      path: '/processes/p1/message',
      options: { method: 'POST', query: { workspace: 'repo/a' }, body: { content: 'hello', deliveryMode: 'enqueue' } },
    });
  });

  it('sends ask-user responses with answer and skip variants', async () => {
    const adapter = createMockAdapter({ ok: true });
    const client = new ProcessesClient(adapter, new CocClient({ fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch }).options);

    await client.askUserResponse('proc/1', { batchId: 'b-1', answers: [{ questionId: 'q-1', answer: 'yes' }] });
    await client.askUserResponse('proc/2', { batchId: 'b-2', answers: [{ questionId: 'q-2', skipped: true }] });
    await client.askUserResponse('proc/3', { batchId: 'b-3', answers: [{ questionId: 'q-3', answer: ['a', 'b'] }] });

    expect(adapter.calls[0]).toMatchObject({
      path: '/processes/proc%2F1/ask-user-response',
      options: { method: 'POST', body: { batchId: 'b-1', answers: [{ questionId: 'q-1', answer: 'yes' }] } },
    });
    expect(adapter.calls[1]).toMatchObject({
      path: '/processes/proc%2F2/ask-user-response',
      options: { method: 'POST', body: { batchId: 'b-2', answers: [{ questionId: 'q-2', skipped: true }] } },
    });
    expect(adapter.calls[2]).toMatchObject({
      path: '/processes/proc%2F3/ask-user-response',
      options: { method: 'POST', body: { batchId: 'b-3', answers: [{ questionId: 'q-3', answer: ['a', 'b'] }] } },
    });
  });
});
