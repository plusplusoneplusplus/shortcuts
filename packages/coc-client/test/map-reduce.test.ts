import { describe, expect, it, vi } from 'vitest';
import {
  CocClient,
  DEFAULT_MAP_REDUCE_MAX_PARALLEL,
  type MapReduceRun,
  type ProcessHistoryItem,
} from '../src';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeRun(overrides: Partial<MapReduceRun> = {}): MapReduceRun {
  return {
    runId: 'map-reduce-run-1',
    workspaceId: 'ws-1',
    status: 'approved',
    originalRequest: 'Map these inputs and reduce the outputs',
    reduceInstructions: 'Aggregate every item output into a concise final answer.',
    maxParallel: DEFAULT_MAP_REDUCE_MAX_PARALLEL,
    childMode: 'ask',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    reduceStep: {
      status: 'pending',
    },
    items: [
      {
        id: 'item-1',
        title: 'First item',
        prompt: 'Map item one',
        status: 'pending',
      },
      {
        id: 'item-2',
        title: 'Second item',
        prompt: 'Map item two',
        dependsOn: ['item-1'],
        status: 'pending',
      },
    ],
    ...overrides,
  };
}

describe('MapReduceClient', () => {
  it('creates a reviewed Map Reduce run without invoking the generation endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ run: makeRun({ runId: 'reviewed-run' }) }));
    const client = new CocClient({ baseUrl: 'http://localhost:4000', fetch });

    const run = await client.mapReduce.create('ws/one', {
      originalRequest: 'Split this',
      sharedInstructions: 'Keep map items isolated',
      reduceInstructions: 'Merge the mapped outputs',
      childMode: 'autopilot',
      maxParallel: 5,
      provider: 'copilot',
      config: { model: 'gpt-5.4', reasoningEffort: 'medium' },
      generationProcessId: 'queue_gen-1',
      generationId: 'map-reduce-gen-1',
      items: makeRun().items,
    });

    expect(run.runId).toBe('reviewed-run');
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:4000/api/workspaces/ws%2Fone/map-reduce-runs');
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      originalRequest: 'Split this',
      sharedInstructions: 'Keep map items isolated',
      reduceInstructions: 'Merge the mapped outputs',
      childMode: 'autopilot',
      maxParallel: 5,
      provider: 'copilot',
      config: { model: 'gpt-5.4', reasoningEffort: 'medium' },
      generationProcessId: 'queue_gen-1',
      generationId: 'map-reduce-gen-1',
      items: makeRun().items,
    });
  });

  it('generates a Map Reduce run through the workspace-scoped route', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ run: makeRun({ runId: 'generated-run' }) }));
    const client = new CocClient({ baseUrl: 'http://localhost:4000', fetch });

    const run = await client.mapReduce.generate('ws/one', {
      prompt: 'Split this',
      sharedInstructions: 'Keep outputs source-linked',
      childMode: 'autopilot',
      provider: 'codex',
      config: { model: 'gpt-5.3-codex', reasoningEffort: 'high' },
    });

    expect(run.runId).toBe('generated-run');
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:4000/api/workspaces/ws%2Fone/map-reduce-runs/generate');
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      prompt: 'Split this',
      sharedInstructions: 'Keep outputs source-linked',
      childMode: 'autopilot',
      provider: 'codex',
      config: { model: 'gpt-5.3-codex', reasoningEffort: 'high' },
    });
  });

  it('lists runs and falls back to an empty list for missing response arrays', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        runs: [{
          ...makeRun(),
          itemCount: 2,
          itemStatusCounts: {
            pending: 2,
            running: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
          },
          reduceStatus: 'pending',
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({}));
    const client = new CocClient({ baseUrl: 'http://localhost:4000', fetch });

    await expect(client.mapReduce.list('ws-1')).resolves.toHaveLength(1);
    await expect(client.mapReduce.list('ws-1')).resolves.toEqual([]);
  });

  it('reads, updates, approves, starts, retries map/reduce work, skips, and cancels by run id', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ run: makeRun() })));
    const client = new CocClient({ baseUrl: 'http://localhost:4000', fetch });

    await client.mapReduce.get('ws-1', 'run/one');
    await client.mapReduce.updatePlan('ws-1', 'run/one', {
      items: makeRun().items,
      sharedInstructions: 'Updated shared instructions',
      reduceInstructions: 'Updated reduce instructions',
      maxParallel: 2,
      childMode: 'ask',
    });
    await client.mapReduce.approve('ws-1', 'run/one');
    await client.mapReduce.start('ws-1', 'run/one');
    await client.mapReduce.continue('ws-1', 'run/one');
    await client.mapReduce.retryItem('ws-1', 'run/one', 'item/one');
    await client.mapReduce.skipItem('ws-1', 'run/one', 'item/one');
    await client.mapReduce.retryReduce('ws-1', 'run/one');
    await client.mapReduce.cancel('ws-1', 'run/one');

    const urls = fetch.mock.calls.map(call => call[0]);
    expect(urls).toEqual([
      'http://localhost:4000/api/workspaces/ws-1/map-reduce-runs/run%2Fone',
      'http://localhost:4000/api/workspaces/ws-1/map-reduce-runs/run%2Fone/plan',
      'http://localhost:4000/api/workspaces/ws-1/map-reduce-runs/run%2Fone/approve',
      'http://localhost:4000/api/workspaces/ws-1/map-reduce-runs/run%2Fone/start',
      'http://localhost:4000/api/workspaces/ws-1/map-reduce-runs/run%2Fone/continue',
      'http://localhost:4000/api/workspaces/ws-1/map-reduce-runs/run%2Fone/items/item%2Fone/retry',
      'http://localhost:4000/api/workspaces/ws-1/map-reduce-runs/run%2Fone/items/item%2Fone/skip',
      'http://localhost:4000/api/workspaces/ws-1/map-reduce-runs/run%2Fone/reduce/retry',
      'http://localhost:4000/api/workspaces/ws-1/map-reduce-runs/run%2Fone/cancel',
    ]);
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'PUT' });
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({
      items: makeRun().items,
      sharedInstructions: 'Updated shared instructions',
      reduceInstructions: 'Updated reduce instructions',
      maxParallel: 2,
      childMode: 'ask',
    });
    for (const call of fetch.mock.calls.slice(2)) {
      expect(call[1]).toMatchObject({ method: 'POST' });
    }
  });
});

describe('Map Reduce process history contract', () => {
  it('accepts map and reduce metadata on ProcessHistoryItem', () => {
    const mapHistoryItem: ProcessHistoryItem = {
      id: 'queue_map-child-1',
      type: 'chat',
      status: 'completed',
      title: 'Map child item',
      startTime: 1,
      mode: 'ask',
      workspaceId: 'ws-1',
      turnCount: 2,
      mapReduce: {
        workspaceId: 'ws-1',
        runId: 'run-1',
        itemId: 'item-1',
        phase: 'map',
        childMode: 'ask',
      },
    };
    const reduceHistoryItem: ProcessHistoryItem = {
      id: 'queue_reduce-child-1',
      type: 'chat',
      status: 'completed',
      title: 'Reduce child item',
      startTime: 2,
      mode: 'autopilot',
      workspaceId: 'ws-1',
      turnCount: 1,
      mapReduce: {
        workspaceId: 'ws-1',
        runId: 'run-1',
        phase: 'reduce',
        childMode: 'autopilot',
      },
    };

    expect(mapHistoryItem.mapReduce?.phase).toBe('map');
    expect(reduceHistoryItem.mapReduce?.phase).toBe('reduce');
  });
});
