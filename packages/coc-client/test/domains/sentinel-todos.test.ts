import { describe, expect, it } from 'vitest';
import { SentinelTodosClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('SentinelTodosClient', () => {
  it.each(['pausePrOutcomes', 'resumePrOutcomes', 'checkPrOutcomes'] as const)('preserves cancellation and revisions for %s', async method => {
    const adapter = createMockAdapter({ paused: false, revision: 3, outcomes: [] });
    const client = new SentinelTodosClient(adapter);
    const controller = new AbortController();
    await client[method]('owner ws', 'parent/a', 'item/a', { expectedRevision: 3 }, { signal: controller.signal });
    controller.abort();
    expect(adapter.calls).toEqual([{
      path: `/workspaces/owner%20ws/sentinel-todos/parent%2Fa/items/item%2Fa/pr-outcomes/${method.replace('PrOutcomes', '')}`,
      options: { method: 'POST', body: { expectedRevision: 3 }, signal: controller.signal },
    }]);
    expect(adapter.calls[0].options?.signal?.aborted).toBe(true);
  });

  it('routes PR outcome controls through the exact encoded owner and retains revisions', async () => {
    const adapter = createMockAdapter({ paused: false, revision: 0, outcomes: [] });
    const client = new SentinelTodosClient(adapter);
    const signal = new AbortController().signal;
    await client.listPrOutcomes('owner ws', 'parent/a', 'item/a', { signal });
    await client.pausePrOutcomes('owner ws', 'parent/a', 'item/a', { expectedRevision: 0 });
    await client.resumePrOutcomes('owner ws', 'parent/a', 'item/a', { expectedRevision: 1 });
    await client.checkPrOutcomes('owner ws', 'parent/a', 'item/a', { expectedRevision: 2 });
    const path = '/workspaces/owner%20ws/sentinel-todos/parent%2Fa/items/item%2Fa/pr-outcomes';
    expect(adapter.calls).toEqual([
      { path, options: { signal } },
      { path: path + '/pause', options: { method: 'POST', body: { expectedRevision: 0 } } },
      { path: path + '/resume', options: { method: 'POST', body: { expectedRevision: 1 } } },
      { path: path + '/check', options: { method: 'POST', body: { expectedRevision: 2 } } },
    ]);
  });
  it('routes older pages, exact item lookup and explicit full snapshots while preserving cancellation', async () => {
    const adapter = createMockAdapter({ revision: 0, items: [], total: 0, hasMore: false, nextOffset: null });
    const client = new SentinelTodosClient(adapter);
    const signal = new AbortController().signal;
    await client.get('owner ws', 'parent/a', { limit: 50, offset: 50, signal });
    await client.get('owner ws', 'parent/a', { itemId: 'older/item' });
    await client.get('owner ws', 'parent/a', { full: true });
    expect(adapter.calls).toEqual([
      { path: '/workspaces/owner%20ws/sentinel-todos/parent%2Fa?limit=50&offset=50', options: { signal } },
      { path: '/workspaces/owner%20ws/sentinel-todos/parent%2Fa?itemId=older%2Fitem', options: undefined },
      { path: '/workspaces/owner%20ws/sentinel-todos/parent%2Fa?full=true', options: undefined },
    ]);
  });

  it('preserves durable requires-review warnings independently of fulfillment and readiness', async () => {
    const item = { id: 'dependent', status: 'done', notes: 'Explicit owner verdict', outcome: {
      summary: 'Accepted result', recordedBy: 'user', recordedAt: '2026-01-01T00:00:00.000Z',
    },
    dependencyReadiness: { requiresReview: true, state: 'waiting', error: 'Prerequisite reopened' } };
    const adapter = createMockAdapter({ revision: 4, items: [item] });
    expect((await new SentinelTodosClient(adapter).get('owner ws', 'parent')).items[0]).toEqual(item);
    expect(adapter.calls).toEqual([{ path: '/workspaces/owner%20ws/sentinel-todos/parent', options: undefined }]);
  });
  it('routes exact evidence authoring and fresh readiness through encoded owner identity', async () => {
    const adapter = createMockAdapter({ state: 'waiting', edges: [] });
    const client = new SentinelTodosClient(adapter);
    const binding = { expectedRevision: 2, outputSlot: 'code', prUrl: 'https://github.com/example/project/pull/42',
      provenance: { kind: 'owner_selection' as const, reason: 'Selected exact output' } };
    const acceptance = { expectedRevision: 3, phase: 'design', reference: 'notes/design.md', version: `sha256:${'a'.repeat(64)}` };
    await client.bindPrOutput('owner ws', 'parent/a', 'item/a', binding);
    await client.acceptArtifact('owner ws', 'parent/a', 'item/a', acceptance);
    const signal = new AbortController().signal;
    await client.evaluateDependencies('owner ws', 'parent/a', 'item/a', { signal });
    const base = '/workspaces/owner%20ws/sentinel-todos/parent%2Fa/items/item%2Fa';
    expect(adapter.calls).toEqual([
      { path: `${base}/pr-output`, options: { method: 'POST', body: binding } },
      { path: `${base}/artifact-acceptance`, options: { method: 'POST', body: acceptance } },
      { path: `${base}/readiness`, options: { method: 'POST', body: {}, signal } },
    ]);
  });

  it('routes complete dependency replacements to the owner with encoded identity and a revision', async () => {
    const adapter = createMockAdapter({ item: { id: 'item/a' }, ledgerRevision: 2 });
    const request = { expectedRevision: 1, dependsOn: [{ itemId: 'source', condition: { kind: 'done' as const } }] };
    await new SentinelTodosClient(adapter).setDependencies('owner ws', 'parent/a', 'item/a', request);
    expect(adapter.calls[0]).toMatchObject({
      path: '/workspaces/owner%20ws/sentinel-todos/parent%2Fa/items/item%2Fa/dependencies',
      options: { method: 'PUT', body: request },
    });
  });
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

  it('round-trips typed references and preserves replacement, omission and clear on the exact encoded owner', async () => {
    const externalReferences = [
      { kind: 'pr' as const, url: 'https://github.com/example/project/pull/42', title: 'Implementation' },
      { kind: 'email' as const, url: 'mailto:review@example.invalid', title: 'Email' },
      { kind: 'link' as const, url: 'https://docs.example.invalid/design' },
    ];
    const conversation = {
      processId: 'queue_design', workspaceId: 'target-ws', openLink: '#repos/target-ws/chats/queue_design',
      attachedAt: '2026-01-01T00:00:00.000Z', attachedBy: 'user' as const,
    };
    const references = [conversation, ...externalReferences];
    const adapter = createMockAdapter({ item: { id: 'item/a', references }, ledgerRevision: 3 });
    const client = new SentinelTodosClient(adapter);
    const create = { title: 'Deliver feature', externalReferences };
    expect((await client.create('owner ws', 'parent/a', create)).item.references).toEqual(references);
    const replace = { expectedRevision: 3, externalReferences: [externalReferences[1]] };
    expect((await client.update('owner ws', 'parent/a', 'item/a', replace)).item.references).toEqual(references);
    await client.update('owner ws', 'parent/a', 'item/a', { expectedRevision: 4, notes: 'Preserve references' });
    await client.update('owner ws', 'parent/a', 'item/a', { expectedRevision: 5, externalReferences: [] });
    const base = '/workspaces/owner%20ws/sentinel-todos/parent%2Fa/items';
    expect(adapter.calls).toEqual([
      { path: base, options: { method: 'POST', body: create } },
      { path: `${base}/item%2Fa`, options: { method: 'PATCH', body: replace } },
      { path: `${base}/item%2Fa`, options: { method: 'PATCH', body: { expectedRevision: 4, notes: 'Preserve references' } } },
      { path: `${base}/item%2Fa`, options: { method: 'PATCH', body: { expectedRevision: 5, externalReferences: [] } } },
    ]);
    const readAdapter = createMockAdapter({ revision: 3, items: [{ id: 'item/a', references }] });
    expect((await new SentinelTodosClient(readAdapter).get('owner ws', 'parent/a')).items[0].references).toEqual(references);
  });

  it('sends priority on create and priority-only update', async () => {
    const adapter = createMockAdapter({ item: { id: 'i1' }, ledgerRevision: 1 });
    const client = new SentinelTodosClient(adapter);
    await client.create('ws', 'p', { title: 'Ship', priority: 'high' });
    await client.update('ws', 'p', 'i1', { expectedRevision: 1, priority: 'regular' });
    expect(adapter.calls[0].options).toMatchObject({ method: 'POST', body: { title: 'Ship', priority: 'high' } });
    expect(adapter.calls[1].options).toEqual(expect.objectContaining({ method: 'PATCH', body: { expectedRevision: 1, priority: 'regular' } }));
  });

  it('preserves exact review evidence in verdict writes and independent assessment in reads', async () => {
    const adapter = createMockAdapter({ item: { id: 'i1' }, ledgerRevision: 5 });
    const client = new SentinelTodosClient(adapter);
    const reviewedJobs = [{ processId: 'queue_child', terminalEventId: 'terminal-event' }];
    await client.update('parent-workspace', 'parent-chat', 'i1', {
      expectedRevision: 4, status: 'todo', statusReason: 'Spec assessed; awaiting approval', reviewedJobs,
    });
    expect(adapter.calls[0]).toMatchObject({
      path: '/workspaces/parent-workspace/sentinel-todos/parent-chat/items/i1',
      options: { method: 'PATCH', body: { expectedRevision: 4, status: 'todo', reviewedJobs } },
    });
    const execution = { state: 'completed', review: {
      state: 'delivered', assessment: 'pending', terminalEventId: 'terminal-event',
    } };
    const readAdapter = createMockAdapter({ revision: 4, items: [{ id: 'i1', jobs: [{ processId: 'queue_child', execution }] }] });
    expect((await new SentinelTodosClient(readAdapter).get('parent-workspace', 'parent-chat')).items[0].jobs[0].execution)
      .toEqual(execution);
  });

  it('round-trips manual item type through create, edit, and ledger reads', async () => {
    const item = { id: 'i1', type: 'manual', title: 'Check release', status: 'todo', priority: 'regular' };
    const adapter = createMockAdapter({ item, ledgerRevision: 1 });
    const client = new SentinelTodosClient(adapter);
    const created = await client.create('ws', 'p', { type: 'manual', title: item.title, idempotencyKey: 'manual-k1' });
    expect(created.item.type).toBe('manual');
    expect(adapter.calls[0].options).toMatchObject({
      method: 'POST', body: { type: 'manual', title: item.title, idempotencyKey: 'manual-k1' },
    });
    const edited = await client.update('ws', 'p', 'i1', { expectedRevision: 1, notes: 'Read notes' });
    expect(edited.item.type).toBe('manual');
    expect(adapter.calls[1].options).toMatchObject({
      method: 'PATCH', body: { expectedRevision: 1, notes: 'Read notes' },
    });
    const readAdapter = createMockAdapter({ revision: 2, items: [item] });
    expect((await new SentinelTodosClient(readAdapter).get('ws', 'p')).items[0].type).toBe('manual');
  });
});
