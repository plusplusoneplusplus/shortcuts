import { describe, expect, it } from 'vitest';
import { SentinelTodosClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('Sentinel to-do tag client', () => {
  it('encodes owner and resource IDs, preserves body CAS/confirmation and cancellation', async () => {
    const adapter = createMockAdapter({ revision: 0, tags: [] });
    const client = new SentinelTodosClient(adapter);
    const signal = new AbortController().signal;
    const request = { expectedRevision: 3, name: 'Backend', color: 'blue' as const, description: 'Server work' };
    await client.getTags('owner ws', 'parent/a', { signal });
    await client.createTag('owner ws', 'parent/a', request);
    await client.updateTag('owner ws', 'parent/a', 'tag/a', request);
    await client.deleteTag('owner ws', 'parent/a', 'tag/a', { expectedRevision: 4, confirmed: true });
    await client.suggestTags('owner ws', 'parent/a', 'item/a', { expectedRevision: 5, expectedTagRevision: 2, multiple: true, confirmed: true });
    const base = '/workspaces/owner%20ws/sentinel-todos/parent%2Fa';
    expect(adapter.calls).toEqual([
      { path: `${base}/tags`, options: { signal } },
      { path: `${base}/tags`, options: { method: 'POST', body: request } },
      { path: `${base}/tags/tag%2Fa`, options: { method: 'PATCH', body: request } },
      { path: `${base}/tags/tag%2Fa`, options: { method: 'DELETE', body: { expectedRevision: 4, confirmed: true } } },
      { path: `${base}/items/item%2Fa/suggest-tags`, options: { method: 'POST', body: { expectedRevision: 5, expectedTagRevision: 2, multiple: true, confirmed: true } } },
    ]);
  });

  it('preserves explicit empty manual selections and optional multiple matching on ordinary writes', async () => {
    const adapter = createMockAdapter({ item: { tagIds: [], tagOrigin: 'manual' }, ledgerRevision: 2 });
    const client = new SentinelTodosClient(adapter);
    await client.create('ws', 'parent', { title: 'Track', tagIds: [], matchMultiple: true });
    await client.update('ws', 'parent', 'item', { expectedRevision: 1, expectedTagRevision: 0, tagIds: [] });
    expect(adapter.calls[0].options?.body).toEqual({ title: 'Track', tagIds: [], matchMultiple: true });
    expect(adapter.calls[1].options?.body).toEqual({ expectedRevision: 1, expectedTagRevision: 0, tagIds: [] });
  });
});
