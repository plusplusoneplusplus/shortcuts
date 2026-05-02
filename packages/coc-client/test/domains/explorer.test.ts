import { describe, expect, it } from 'vitest';
import { ExplorerClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('ExplorerClient', () => {
  it('calls repo browsing, search, blob, and reveal endpoints with typed query options', async () => {
    const adapter = createMockAdapter({ entries: [], files: [], results: [], truncated: false, success: true });
    const client = new ExplorerClient(adapter);

    await client.listRepos();
    await client.tree('repo/a', { path: '/', depth: 2, showIgnored: true });
    await client.listFiles('repo/a', { path: 'src', showIgnored: false });
    await client.searchFiles('repo/a', 'main ts', { limit: 100 });
    await client.readBlob('repo/a', 'src/main.ts');
    await client.writeBlob('repo/a', 'src/main.ts', 'const x = 1;');
    await client.reveal('repo/a', 'src/main.ts');
    await client.readTrustedBlob('C:\\trusted\\plan.md');

    expect(adapter.calls).toMatchObject([
      { path: '/repos' },
      { path: '/repos/repo%2Fa/tree', options: { query: { path: '/', depth: 2, showIgnored: true } } },
      { path: '/repos/repo%2Fa/files', options: { query: { path: 'src', showIgnored: false } } },
      { path: '/repos/repo%2Fa/search', options: { query: { q: 'main ts', limit: 100 } } },
      { path: '/repos/repo%2Fa/blob', options: { query: { path: 'src/main.ts' } } },
      { path: '/repos/repo%2Fa/blob', options: { method: 'PUT', query: { path: 'src/main.ts' }, body: { content: 'const x = 1;' } } },
      { path: '/repos/repo%2Fa/reveal', options: { query: { path: 'src/main.ts' } } },
      { path: '/fs/blob', options: { query: { path: 'C:\\trusted\\plan.md' } } },
    ]);
  });

  it('encodes repo IDs with special characters once and leaves file paths in query params', async () => {
    const adapter = createMockAdapter({});
    const client = new ExplorerClient(adapter);
    const repoId = 'repo/a space/%done';
    const filePath = 'src/space %/main.ts';

    await client.tree(repoId, { path: filePath });
    await client.searchFiles(repoId, 'main ts', { limit: 50 });
    await client.readBlob(repoId, filePath);

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/repos/repo%2Fa%20space%2F%25done/tree',
      '/repos/repo%2Fa%20space%2F%25done/search',
      '/repos/repo%2Fa%20space%2F%25done/blob',
    ]);
    expect(adapter.calls[0].options?.query).toEqual({ path: filePath, depth: undefined, showIgnored: undefined });
    expect(adapter.calls[1].options?.query).toEqual({ q: 'main ts', limit: 50, showIgnored: undefined });
    expect(adapter.calls[2].options?.query).toEqual({ path: filePath });
  });
});
