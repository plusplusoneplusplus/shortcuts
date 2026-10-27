import { describe, expect, it } from 'vitest';
import { SentinelTodosClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('Workspace Sentinel category client', () => {
  it('uses the supplied owner transport, encodes IDs and preserves revisions, confirmation and cancellation', async () => {
    const result = { revision: 3, categories: [{ id: 'category/a', name: 'Server' }] };
    const adapter = createMockAdapter(result);
    const client = new SentinelTodosClient(adapter);
    const signal = new AbortController().signal;
    const write = { expectedRevision: 2, name: 'Server' };
    expect(await client.getCategories('owner ws', 'parent/a', { signal })).toBe(result);
    expect(await client.createCategory('owner ws', 'parent/a', write)).toBe(result);
    expect(await client.updateCategory('owner ws', 'parent/a', 'category/a', write)).toBe(result);
    await client.reorderCategories('owner ws', 'parent/a', { expectedRevision: 3, categoryIds: ['category/a'] });
    await client.getCategoryUsage('owner ws', 'parent/a', 'category/a', { signal });
    await client.deleteCategory('owner ws', 'parent/a', 'category/a', { expectedRevision: 4, confirmed: true });
    const base = '/workspaces/owner%20ws/sentinel-todos/parent%2Fa/categories';
    expect(adapter.calls).toEqual([
      { path: base, options: { signal } },
      { path: base, options: { method: 'POST', body: write } },
      { path: `${base}/category%2Fa`, options: { method: 'PATCH', body: write } },
      { path: base, options: { method: 'PUT', body: { expectedRevision: 3, categoryIds: ['category/a'] } } },
      { path: `${base}/category%2Fa/usage`, options: { signal } },
      { path: `${base}/category%2Fa`, options: { method: 'DELETE', body: { expectedRevision: 4, confirmed: true } } },
    ]);
  });
});
