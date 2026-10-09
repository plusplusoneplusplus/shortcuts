import { describe, expect, it } from 'vitest';
import { CocClient, SentinelTodosClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('SentinelTodosClient', () => {
  it('reads the encoded ledger route of one chat', async () => {
    const adapter = createMockAdapter({ revision: 0, items: [] });
    const ledger = await new SentinelTodosClient(adapter).get('ws one', 'queue_a/b');
    expect(adapter.calls[0].path).toBe('/workspaces/ws%20one/sentinel-todos/queue_a%2Fb');
    expect(ledger).toEqual({ revision: 0, items: [] });
  });

  it('creates with POST and edits with PATCH carrying expectedRevision', async () => {
    const adapter = createMockAdapter({ item: { id: 'i1' }, ledgerRevision: 1 });
    const client = new SentinelTodosClient(adapter);
    await client.create('ws', 'p', { title: 'Ship', idempotencyKey: 'k1' });
    await client.update('ws', 'p', 'item 1', { expectedRevision: 2, status: 'done', statusReason: 'Verified' });
    expect(adapter.calls[0]).toMatchObject({ path: '/workspaces/ws/sentinel-todos/p/items', options: { method: 'POST', body: { title: 'Ship', idempotencyKey: 'k1' } } });
    expect(adapter.calls[1]).toMatchObject({
      path: '/workspaces/ws/sentinel-todos/p/items/item%201',
      options: { method: 'PATCH', body: { expectedRevision: 2, status: 'done', statusReason: 'Verified' } },
    });
  });

  it('sends priority on create and priority-only update', async () => {
    const adapter = createMockAdapter({ item: { id: 'i1' }, ledgerRevision: 1 });
    const client = new SentinelTodosClient(adapter);
    await client.create('ws', 'p', { title: 'Ship', priority: 'high' });
    await client.update('ws', 'p', 'i1', { expectedRevision: 1, priority: 'regular' });
    expect(adapter.calls[0].options).toMatchObject({ method: 'POST', body: { title: 'Ship', priority: 'high' } });
    expect(adapter.calls[1].options).toEqual(expect.objectContaining({ method: 'PATCH', body: { expectedRevision: 1, priority: 'regular' } }));
  });

  it('is exposed on CocClient', () => {
    expect(new CocClient({ baseUrl: 'http://localhost:4000' }).sentinelTodos).toBeInstanceOf(SentinelTodosClient);
  });
});
