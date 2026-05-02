import { describe, expect, it } from 'vitest';
import { CocClient, ProcessesClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('ProcessesClient', () => {
  it('serializes list filters and gets process details', async () => {
    const adapter = createMockAdapter({ processes: [] });
    const client = new ProcessesClient(adapter, new CocClient({ fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch }).options);

    await client.list({ workspace: 'repo/a', status: ['running', 'queued'], exclude: ['conversation', 'toolCalls'], limit: 5 });
    await client.get('proc/1', { workspace: 'repo/a' });

    expect(adapter.calls[0]).toMatchObject({
      path: '/processes',
      options: { query: { workspace: 'repo/a', status: 'running,queued', exclude: 'conversation,toolCalls', limit: 5 } },
    });
    expect(adapter.calls[1].path).toBe('/processes/proc%2F1');
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
