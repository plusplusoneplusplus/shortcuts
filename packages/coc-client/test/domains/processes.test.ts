import { describe, expect, it } from 'vitest';
import { AUTO_COMPACT_THRESHOLD_DEFAULT, CocClient, ProcessesClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('ProcessesClient', () => {
  it('passes cancellation and owner filters to index-only summary reads', async () => {
    const adapter = createMockAdapter({ summaries: [], total: 0, limit: 200, offset: 0 });
    const client = new ProcessesClient(adapter, new CocClient().options);
    const controller = new AbortController();
    await client.summaries({ workspace: 'owner', type: 'chat', archived: false, limit: 200, offset: 0 },
      { signal: controller.signal });
    expect(adapter.calls).toEqual([{ path: '/processes/summaries', options: {
      query: { workspace: 'owner', type: 'chat', archived: false, limit: 200, offset: 0,
        status: undefined, exclude: undefined, include: undefined },
      signal: controller.signal,
    } }]);
  });

  it('lazily retrieves startup inventory with exact owner, encoded process ID and cancellation', async () => {
    const adapter = createMockAdapter({ state: 'unavailable' });
    const client = new ProcessesClient(adapter, new CocClient().options);
    const controller = new AbortController();
    await expect(client.getToolInventory('proc/1 %done', { workspace: 'owner/ws' }, { signal: controller.signal }))
      .resolves.toEqual({ state: 'unavailable' });
    expect(adapter.calls).toEqual([{ path: '/processes/proc%2F1%20%25done/tool-inventory', options: {
      query: { workspace: 'owner/ws' }, signal: controller.signal,
    } }]);
  });

  it('keeps inventory requests on the configured remote owner without local fallback or retries', async () => {
    const urls: string[] = [];
    const controller = new AbortController();
    const client = new CocClient({ baseUrl: 'https://owner.example', fetch: async (input, init) => {
      urls.push(String(input));
      expect(init?.signal).toBe(controller.signal);
      throw new DOMException('Aborted', 'AbortError');
    } });
    controller.abort();
    await expect(client.processes.getToolInventory('p', { workspace: 'owner' }, { signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ABORTED' });
    expect(urls).toEqual(['https://owner.example/api/processes/p/tool-inventory?workspace=owner']);
  });

  it('propagates inventory errors instead of returning unavailable', async () => {
    const urls: string[] = [];
    const client = new CocClient({ baseUrl: 'https://owner.example', fetch: async input => {
      urls.push(String(input));
      return new Response(JSON.stringify({ error: 'Read failed', code: 'INTERNAL_ERROR' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    } });
    await expect(client.processes.getToolInventory('p', { workspace: 'owner' }))
      .rejects.toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(urls).toHaveLength(1);
  });

  it('preserves preview and paging options together on the owning cancellable detail request', async () => {
    const adapter = createMockAdapter({});
    const client = new ProcessesClient(adapter, new CocClient().options);
    const controller = new AbortController();
    await client.get('proc/1', { workspace: 'owner', preview: true, turnsLimit: 30, include: ['children'] }, { signal: controller.signal });
    expect(adapter.calls).toEqual([{ path: '/processes/proc%2F1', options: {
      query: { workspace: 'owner', preview: true, turnsLimit: 30, include: 'children', status: undefined, exclude: undefined },
      signal: controller.signal,
    } }]);
  });
  it('preserves unparameterized detail options and serializes bounded history with cancellation', async () => {
    const adapter = createMockAdapter({});
    const client = new ProcessesClient(adapter, new CocClient().options);
    const controller = new AbortController();
    await client.get('proc/1');
    expect(adapter.calls[0]).toEqual({ path: '/processes/proc%2F1', options: { query: undefined } });
    await client.get('proc/1', { workspace: 'owner', turnsLimit: 30, include: ['children'] }, { signal: controller.signal });
    expect(adapter.calls[1]).toMatchObject({ path: '/processes/proc%2F1', options: {
      query: { workspace: 'owner', turnsLimit: 30, include: 'children' }, signal: controller.signal,
    } });
    await client.listTurns('proc/1', { workspace: 'owner', beforeTurnIndex: 170, limit: 30 }, { signal: controller.signal });
    expect(adapter.calls[2]).toEqual({ path: '/processes/proc%2F1/turns', options: {
      query: { workspace: 'owner', beforeTurnIndex: 170, limit: 30 }, signal: controller.signal,
    } });
    await client.pinnedTurns('proc/1', { workspace: 'owner' }, { signal: controller.signal });
    expect(adapter.calls[3]).toMatchObject({ path: '/processes/proc%2F1/turns/pinned',
      options: { query: { workspace: 'owner' }, signal: controller.signal } });
  });

  it('keeps every history read on its configured owner and aborts without local retries', async () => {
    const controller = new AbortController();
    const urls: string[] = [];
    const client = new CocClient({ baseUrl: 'https://owner.example', fetch: async (input, init) => {
      urls.push(String(input));
      expect(init?.signal).toBe(controller.signal);
      throw new DOMException('Aborted', 'AbortError');
    } });
    controller.abort();
    await expect(client.processes.get('p', { workspace: 'owner', turnsLimit: 30 }, { signal: controller.signal })).rejects.toThrow();
    await expect(client.processes.listTurns('p', { workspace: 'owner', beforeTurnIndex: 30 }, { signal: controller.signal })).rejects.toThrow();
    expect(urls).toHaveLength(2);
    expect(urls.every(url => url.startsWith('https://owner.example/api/processes/p'))).toBe(true);
  });

  it('preserves queued compaction responses and scopes cancellation to its workspace', async () => {
    const adapter = createMockAdapter({ state: 'queued', taskId: 'compact-task' });
    const client = new ProcessesClient(adapter, new CocClient({ fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch }).options);
    await expect(client.compact('proc/1', 'keep decisions', { workspace: 'remote/workspace' }))
      .resolves.toEqual({ state: 'queued', taskId: 'compact-task' });
    await client.cancelCompaction('proc/1', { workspace: 'remote/workspace' });
    expect(adapter.calls[1]).toMatchObject({ path: '/processes/proc%2F1/compact',
      options: { method: 'DELETE', query: { workspace: 'remote/workspace' } } });
  });

  it('scopes auto-compact settings and resume to the owning workspace', async () => {
    const autoCompact = { enabled: true, thresholdTokens: 700000 };
    const adapter = createMockAdapter({ autoCompact });
    const client = new ProcessesClient(adapter, new CocClient({ fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch }).options);
    await expect(client.updateAutoCompact('proc/1', { enabled: true, thresholdTokens: 700000 }, { workspace: 'remote/ws' }))
      .resolves.toEqual({ autoCompact });
    await client.resumeAutoCompact('proc/1', { workspace: 'remote/ws' });
    expect(adapter.calls[0]).toMatchObject({ path: '/processes/proc%2F1/auto-compact',
      options: { method: 'PUT', query: { workspace: 'remote/ws' }, body: { enabled: true, thresholdTokens: 700000 } } });
    expect(adapter.calls[1]).toMatchObject({ path: '/processes/proc%2F1/auto-compact/resume',
      options: { method: 'POST', query: { workspace: 'remote/ws' } } });
  });

  it('scopes additional-instructions reads and saves to the owning workspace', async () => {
    const additionalInstructions = { text: 'Prefer small PRs', updatedAt: '2026-10-19T00:00:00.000Z' };
    const adapter = createMockAdapter({ additionalInstructions });
    const client = new ProcessesClient(adapter, new CocClient().options);
    await expect(client.getAdditionalInstructions('proc/1', { workspace: 'remote/ws' }))
      .resolves.toEqual({ additionalInstructions });
    await client.updateAdditionalInstructions('proc/1', 'Prefer small PRs', { workspace: 'remote/ws' });
    expect(adapter.calls[0]).toEqual({ path: '/processes/proc%2F1/additional-instructions',
      options: { query: { workspace: 'remote/ws' } } });
    expect(adapter.calls[1]).toMatchObject({ path: '/processes/proc%2F1/additional-instructions',
      options: { method: 'PUT', query: { workspace: 'remote/ws' }, body: { text: 'Prefer small PRs' } } });
  });

  it('uses a 700000-token default without enabling auto-compact', async () => {
    const adapter = createMockAdapter({ autoCompact: { enabled: false, thresholdTokens: AUTO_COMPACT_THRESHOLD_DEFAULT } });
    const client = new ProcessesClient(adapter, new CocClient().options);
    await client.updateAutoCompact('s', { enabled: false, thresholdTokens: AUTO_COMPACT_THRESHOLD_DEFAULT });
    expect(adapter.calls[0].options?.body).toEqual({ enabled: false, thresholdTokens: 700000 });
  });

  it('surfaces unsupported-state and persistence errors without fallback requests', async () => {
    const calls: string[] = [];
    const client = new CocClient({ fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const resume = url.endsWith('/resume');
      return new Response(JSON.stringify({
        error: resume ? 'Explicitly configure thresholdTokens with PUT' : 'Internal server error',
        code: resume ? 'AUTO_COMPACT_UNSUPPORTED_STATE' : 'INTERNAL_ERROR',
      }), { status: resume ? 409 : 500, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch });
    await expect(client.processes.resumeAutoCompact('s')).rejects.toMatchObject({ code: 'AUTO_COMPACT_UNSUPPORTED_STATE' });
    await expect(client.processes.updateAutoCompact('s', { enabled: false, thresholdTokens: 700000 }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(calls).toHaveLength(2);
  });

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
