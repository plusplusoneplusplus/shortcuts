import { describe, expect, it, vi } from 'vitest';
import { CocApiError, CocClient, CocNetworkError, SentinelTodosClient } from '../../src';
import type { SentinelCodaRunDetail, SentinelCodaResponse } from '../../src';
import { createMockAdapter } from './helpers';

const ownerPath = '/workspaces/ws%20one/sentinel-todos/chat%23one/scrubber';

describe('Sentinel scrubber client', () => {
  it('reads owner state and full findings without dropping audit or snapshot metadata', async () => {
    const run: SentinelCodaRunDetail = {
      id: 'run/one', trigger: 'manual', status: 'completed', createdAt: '2026-10-11T09:00:00Z',
      snapshot: [{ itemId: 'item one', revision: 3 }], deferredItemIds: ['later'], awaitingReviewItemIds: ['pending'],
      findings: [{
        runId: 'run/one', itemId: 'item one', itemRevision: 3, fingerprint: 'hash', state: 'proposed',
        demotedBecause: 'manual', finding: {
          itemId: 'item one', verdict: 'done', confidence: 'high', autoApply: true,
          summary: 'Merged', rationale: 'Completion verified', evidence: [{
            kind: 'pr', ref: 'https://example.test/pull/1', state: 'merged', checkedAt: '2026-10-11T09:01:00Z',
          }],
        }, audit: [{ action: 'dismissed', actor: 'user', at: '2026-10-11T09:02:00Z' }],
      }],
    };
    const state: SentinelCodaResponse = {
      config: { enabled: false, cron: '0 9 * * *', paused: false, consecutiveFailures: 0, revision: 0 },
      runs: [],
    };
    const adapter = createMockAdapter(state);
    const signal = new AbortController().signal;
    expect(await new SentinelTodosClient(adapter).scrubber.get('ws one', 'chat#one', { signal })).toBe(state);
    expect(adapter.calls[0]).toEqual({ path: ownerPath, options: { signal } });
    const detailAdapter = createMockAdapter(run);
    expect(await new SentinelTodosClient(detailAdapter).scrubber.getRun('ws one', 'chat#one', 'run/one', { signal })).toBe(run);
    expect(detailAdapter.calls[0]).toEqual({ path: ownerPath + '/runs/run%2Fone', options: { signal } });
  });

  it('saves revision-safe schedule settings and starts all-open or selected runs', async () => {
    const adapter = createMockAdapter({ runId: 'r' });
    const client = new SentinelTodosClient(adapter).scrubber;
    const config = { enabled: true, cron: '0 */6 * * *', expectedRevision: 7 };
    await client.updateConfig('ws one', 'chat#one', config);
    // A caller may receive only the run identity when child identity is unavailable.
    expect(await client.start('ws one', 'chat#one')).toEqual({ runId: 'r' });
    await client.start('ws one', 'chat#one', { itemIds: ['one', 'two'] });
    expect(adapter.calls).toEqual([
      { path: ownerPath + '/config', options: { method: 'PUT', body: config } },
      { path: ownerPath + '/runs', options: { method: 'POST', body: {} } },
      { path: ownerPath + '/runs', options: { method: 'POST', body: { itemIds: ['one', 'two'] } } },
    ]);
  });

  it('cancels the exact run and sends item revisions for each finding action', async () => {
    const adapter = createMockAdapter({ finding: { state: 'dismissed' } });
    const client = new SentinelTodosClient(adapter).scrubber;
    await client.cancel('ws one', 'chat#one', 'run/one');
    for (const action of ['accept', 'dismiss', 'undo'] as const) {
      const response = await client[action]('ws one', 'chat#one', 'run/one', 'item?one', { expectedItemRevision: 4 });
      expect(response).toEqual({ finding: { state: 'dismissed' } });
    }
    expect(adapter.calls[0]).toEqual({ path: ownerPath + '/runs/run%2Fone/cancel', options: { method: 'POST' } });
    for (const [index, action] of ['accept', 'dismiss', 'undo'].entries()) {
      expect(adapter.calls[index + 1]).toEqual({
        path: ownerPath + `/runs/run%2Fone/findings/item%3Fone/${action}`,
        options: { method: 'POST', body: { expectedItemRevision: 4 } },
      });
    }
  });

  it('keeps same-named owners on their chosen host across reads and writes', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => Response.json({ runs: [] }));
    const local = new CocClient({ baseUrl: 'http://local.test', fetch });
    const remote = new CocClient({ baseUrl: 'https://remote.test', fetch });
    await local.sentinelTodos.scrubber.get('ws-owner', 'chat');
    await remote.sentinelTodos.scrubber.get('ws-owner', 'chat');
    await remote.sentinelTodos.scrubber.start('group-owner', 'chat');
    await remote.sentinelTodos.scrubber.accept('group-owner', 'chat', 'run', 'item', { expectedItemRevision: 9 });
    expect(fetch.mock.calls.map(call => String(call[0]))).toEqual([
      'http://local.test/api/workspaces/ws-owner/sentinel-todos/chat/scrubber',
      'https://remote.test/api/workspaces/ws-owner/sentinel-todos/chat/scrubber',
      'https://remote.test/api/workspaces/group-owner/sentinel-todos/chat/scrubber/runs',
      'https://remote.test/api/workspaces/group-owner/sentinel-todos/chat/scrubber/runs/run/findings/item/accept',
    ]);
  });

  it.each([400, 404, 409])('preserves HTTP %s structured errors without retrying a mutation', async status => {
    const body = { error: 'Item changed since this proposal', code: 'conflict', current: { id: 'item', revision: 10 } };
    const fetch = vi.fn(async () => Response.json(body, { status }));
    const client = new CocClient({ baseUrl: 'https://remote.test', fetch });
    const error = await client.sentinelTodos.scrubber.accept('ws', 'p', 'r', 'item', { expectedItemRevision: 9 }).catch(e => e);
    expect(error).toBeInstanceOf(CocApiError);
    expect(error).toMatchObject({ status, code: 'conflict', body });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('passes read cancellation through the owning transport', async () => {
    const controller = new AbortController();
    controller.abort('owner changed');
    const fetch = vi.fn(async (_url: unknown, options?: RequestInit) => {
      expect(options?.signal?.aborted).toBe(true);
      throw options?.signal?.reason;
    });
    const client = new CocClient({ baseUrl: 'https://remote.test', fetch });
    const error = await client.sentinelTodos.scrubber.getRun('ws', 'p', 'r', { signal: controller.signal }).catch(e => e);
    expect(error).toBeInstanceOf(CocNetworkError);
    expect(error).toMatchObject({ code: 'ABORTED', cause: 'owner changed' });
  });
});
