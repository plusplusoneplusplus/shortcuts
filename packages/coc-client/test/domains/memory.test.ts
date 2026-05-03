import { describe, expect, it } from 'vitest';
import { MemoryClient } from '../../src';
import { CocApiError } from '../../src/errors';
import { createMockAdapter } from './helpers';

describe('MemoryClient', () => {
  it('encodes repo IDs and delegates repo-scoped memory requests', async () => {
    const adapter = createMockAdapter({
      taskId: 'task-1',
      processId: null,
      status: 'queued',
    });
    const client = new MemoryClient(adapter);

    await client.getRepoOverview('repo/a');
    await client.getRepoBounded('repo/a');
    await client.saveRepoBounded('repo/a', 'Remember this');
    await client.deleteRepoMemory('repo/a');
    await client.promoteRepo('repo/a', { model: 'gpt-test', target: 'system' });
    expect(adapter.calls).toEqual([
      { path: '/repos/repo%2Fa/memory/overview', options: undefined },
      { path: '/repos/repo%2Fa/memory/bounded', options: undefined },
      {
        path: '/repos/repo%2Fa/memory/bounded',
        options: { method: 'PUT', body: { content: 'Remember this' } },
      },
      {
        path: '/repos/repo%2Fa/memory',
        options: { method: 'DELETE' },
      },
      {
        path: '/repos/repo%2Fa/memory/aggregate',
        options: { method: 'POST', body: { model: 'gpt-test', target: 'system' } },
      },
    ]);
  });

  it('serializes memory level hash parameters for bounded memory reads and writes', async () => {
    const adapter = createMockAdapter({});
    const client = new MemoryClient(adapter);

    await client.getConfig();
    await client.replaceConfig({ storageDir: 'C:\\memory', backend: 'sqlite' });
    await client.getBoundedLevels();
    await client.getBoundedLevel('system');
    await client.getBoundedLevel('repo', { hash: 'repo/hash' });
    await client.saveBoundedLevel('git-remote', 'Remote memory', { hash: 'remote hash' });

    expect(adapter.calls).toEqual([
      { path: '/memory/config', options: undefined },
      {
        path: '/memory/config',
        options: { method: 'PUT', body: { storageDir: 'C:\\memory', backend: 'sqlite' } },
      },
      { path: '/memory/bounded/levels', options: undefined },
      { path: '/memory/bounded/system', options: { query: undefined } },
      { path: '/memory/bounded/repo', options: { query: { hash: 'repo/hash' } } },
      {
        path: '/memory/bounded/git-remote',
        options: {
          method: 'PUT',
          query: { hash: 'remote hash' },
          body: { content: 'Remote memory' },
        },
      },
    ]);
  });

  it('resolves repo memory delete responses', async () => {
    const adapter = createMockAdapter({ success: true });
    const client = new MemoryClient(adapter);

    await expect(client.deleteRepoMemory('repo/a')).resolves.toEqual({ success: true });
    expect(adapter.calls).toEqual([
      { path: '/repos/repo%2Fa/memory', options: { method: 'DELETE' } },
    ]);
  });

  it('serializes delete tokens and explore-cache browsing parameters', async () => {
    const adapter = createMockAdapter({});
    const client = new MemoryClient(adapter);

    await client.deleteBoundedLevel('repo', { hash: 'repo hash', token: 'token-1' });
    await client.getExploreCacheLevels();
    await client.listExploreCacheRaw('repo', { hash: 'repo hash' });
    await client.getExploreCacheRaw('entry/file.json', 'repo', { hash: 'repo hash' });
    await client.listExploreCacheConsolidated('git-remote', { hash: 'remote hash' });
    await client.getExploreCacheConsolidated('entry/id', 'git-remote', { hash: 'remote hash' });

    expect(adapter.calls).toEqual([
      {
        path: '/memory/bounded/repo',
        options: { method: 'DELETE', query: { hash: 'repo hash', token: 'token-1' } },
      },
      { path: '/memory/explore-cache/levels', options: undefined },
      {
        path: '/memory/explore-cache/raw',
        options: { query: { level: 'repo', hash: 'repo hash' } },
      },
      {
        path: '/memory/explore-cache/raw/entry%2Ffile.json',
        options: { query: { level: 'repo', hash: 'repo hash' } },
      },
      {
        path: '/memory/explore-cache/consolidated',
        options: { query: { level: 'git-remote', hash: 'remote hash' } },
      },
      {
        path: '/memory/explore-cache/consolidated/entry%2Fid',
        options: { query: { level: 'git-remote', hash: 'remote hash' } },
      },
    ]);
  });

  it('returns promotion conflict bodies as successful promotion responses', async () => {
    const adapter = createMockAdapter({});
    adapter.request = async () => {
      throw new CocApiError({
        status: 409,
        statusText: 'Conflict',
        url: '/api/repos/repo-a/memory/aggregate',
        message: 'Already queued',
        body: { taskId: 'task-1', processId: 'proc-1', operation: 'promotion', status: 'already-queued' },
      });
    };
    const client = new MemoryClient(adapter);

    await expect(client.promoteRepo('repo-a')).resolves.toEqual({
      taskId: 'task-1',
      processId: 'proc-1',
      operation: 'promotion',
      status: 'already-queued',
    });
  });
});
