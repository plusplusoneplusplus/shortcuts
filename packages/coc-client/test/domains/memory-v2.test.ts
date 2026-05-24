import { describe, expect, it } from 'vitest';
import { MemoryV2Client, type MemoryEpisode, type MemoryFact, type MemoryV2ExportData } from '../../src';
import { createMockAdapter } from './helpers';

const FACT: MemoryFact = {
  id: 'fact/1',
  scope: 'global',
  content: 'The project uses Memory V2',
  importance: 0.8,
  confidence: 0.95,
  status: 'active',
  tags: ['memory'],
  source: 'explicit',
  sourceProcessId: 'proc-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  recalledCount: 0,
};

const EPISODE: MemoryEpisode = {
  id: 'episode/1',
  scope: 'global',
  processId: 'proc-1',
  summary: 'Discussed Memory V2',
  eventType: 'chat-turn',
  createdAt: '2026-01-01T00:00:00.000Z',
  provenance: { createdBy: 'ai', version: 1 },
};

const EXPORT_DATA: MemoryV2ExportData = {
  version: 1,
  exportedAt: '2026-01-01T00:00:00.000Z',
  scope: 'global',
  facts: [FACT],
  episodes: [EPISODE],
};

describe('MemoryV2Client', () => {
  it('constructs fact, review, episode, export, and wipe requests', async () => {
    const adapter = createMockAdapter({});
    adapter.request = async (path, options) => {
      adapter.calls.push({ path, options });
      if (path.endsWith('/export')) return EXPORT_DATA as never;
      if (path.endsWith('/episodes')) return { episodes: [EPISODE] } as never;
      if (path.endsWith('/wipe')) return { wiped: true } as never;
      return { facts: [FACT], fact: FACT, deleted: true } as never;
    };
    const client = new MemoryV2Client(adapter);

    await expect(client.listFacts('repo/a', {
      q: 'sqlite memory',
      status: ['active', 'review'],
      limit: 25,
    })).resolves.toEqual([FACT]);
    await expect(client.createFact('repo/a', 'Remember this', {
      importance: 0.7,
      tags: ['one', 'two'],
      sourceProcessId: 'proc/1',
    })).resolves.toEqual(FACT);
    await expect(client.updateFact('repo/a', 'fact/1', {
      content: 'Updated',
      importance: 0.9,
      tags: ['updated'],
      status: 'archived',
    })).resolves.toEqual(FACT);
    await client.deleteFact('repo/a', 'fact/1');
    await expect(client.listReview('repo/a')).resolves.toEqual([FACT]);
    await expect(client.approveReview('repo/a', 'fact/1')).resolves.toEqual(FACT);
    await expect(client.approveReview('repo/a', 'fact/1', 'Edited content')).resolves.toEqual(FACT);
    await expect(client.rejectReview('repo/a', 'fact/1')).resolves.toEqual(FACT);
    await expect(client.listEpisodes('repo/a', 10)).resolves.toEqual([EPISODE]);
    await expect(client.exportData('repo/a')).resolves.toEqual(EXPORT_DATA);
    await client.wipe('repo/a');

    expect(adapter.calls).toEqual([
      {
        path: '/workspaces/repo%2Fa/memory/v2/facts?q=sqlite+memory&status=active&status=review&limit=25',
        options: undefined,
      },
      {
        path: '/workspaces/repo%2Fa/memory/v2/facts',
        options: {
          method: 'POST',
          body: {
            content: 'Remember this',
            importance: 0.7,
            tags: ['one', 'two'],
            sourceProcessId: 'proc/1',
          },
        },
      },
      {
        path: '/workspaces/repo%2Fa/memory/v2/facts/fact%2F1',
        options: {
          method: 'PATCH',
          body: {
            content: 'Updated',
            importance: 0.9,
            tags: ['updated'],
            status: 'archived',
          },
        },
      },
      {
        path: '/workspaces/repo%2Fa/memory/v2/facts/fact%2F1',
        options: { method: 'DELETE' },
      },
      { path: '/workspaces/repo%2Fa/memory/v2/review', options: undefined },
      {
        path: '/workspaces/repo%2Fa/memory/v2/review/fact%2F1/approve',
        options: { method: 'POST', body: {} },
      },
      {
        path: '/workspaces/repo%2Fa/memory/v2/review/fact%2F1/approve',
        options: { method: 'POST', body: { content: 'Edited content' } },
      },
      {
        path: '/workspaces/repo%2Fa/memory/v2/review/fact%2F1/reject',
        options: { method: 'POST' },
      },
      {
        path: '/workspaces/repo%2Fa/memory/v2/episodes',
        options: { query: { limit: 10 } },
      },
      { path: '/workspaces/repo%2Fa/memory/v2/export', options: undefined },
      {
        path: '/workspaces/repo%2Fa/memory/v2/wipe',
        options: { method: 'DELETE', body: { confirm: true } },
      },
    ]);
  });

  it('omits fact query parameters when filters are not provided', async () => {
    const adapter = createMockAdapter({ facts: [] });
    const client = new MemoryV2Client(adapter);

    await expect(client.listFacts('repo/a')).resolves.toEqual([]);
    await expect(client.listFacts('repo/a', { status: 'active' })).resolves.toEqual([]);

    expect(adapter.calls).toEqual([
      { path: '/workspaces/repo%2Fa/memory/v2/facts', options: undefined },
      { path: '/workspaces/repo%2Fa/memory/v2/facts?status=active', options: undefined },
    ]);
  });
});
