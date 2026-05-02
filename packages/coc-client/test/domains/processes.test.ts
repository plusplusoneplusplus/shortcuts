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
    await client.deleteTurn('proc/1', 3);
    await client.restoreTurn('proc/1', 3);
    await client.pinTurn('proc/1', 3, true);
    await client.archiveTurn('proc/1', 3, false);
    await client.pinnedTurns('proc/1');
    await client.resumeCli('proc/1');
    await client.fork('proc/1', { workspace: 'repo/a' });

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
      '/processes/proc%2F1/turns/3',
      '/processes/proc%2F1/turns/3/restore',
      '/processes/proc%2F1/turns/3/pin',
      '/processes/proc%2F1/turns/3/archive',
      '/processes/proc%2F1/turns/pinned',
      '/processes/proc%2F1/resume-cli',
      '/processes/proc%2F1/fork',
    ]);
    expect(adapter.calls[5].options).toMatchObject({ method: 'PATCH', body: { pinned: true } });
    expect(adapter.calls[6].options).toMatchObject({ method: 'PATCH', body: { archived: false } });
    expect(adapter.calls[9].options).toMatchObject({ method: 'POST', query: { workspace: 'repo/a' }, body: {} });
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
});
