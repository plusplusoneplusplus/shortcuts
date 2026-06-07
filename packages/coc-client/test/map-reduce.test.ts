import { describe, expect, it, vi } from 'vitest';
import {
  CocClient,
  DEFAULT_MAP_REDUCE_MAX_PARALLEL,
  normalizeMapReducePlanItems,
  scanMapReducePlanArtifacts,
  validateMapReduceDraftPlan,
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

describe('Map Reduce plan validation', () => {
  it('normalizes items, reduce instructions, maxParallel, and validates dependencies', () => {
    const items = normalizeMapReducePlanItems([
      { id: ' item-1 ', title: ' First ', prompt: ' Map first ', status: 'pending' },
      { id: 'item-2', title: 'Second', prompt: 'Map second', status: 'pending', dependsOn: [' item-1 '] },
    ]);

    expect(items).toEqual([
      { id: 'item-1', title: 'First', prompt: 'Map first', status: 'pending' },
      { id: 'item-2', title: 'Second', prompt: 'Map second', status: 'pending', dependsOn: ['item-1'] },
    ]);

    expect(validateMapReduceDraftPlan({
      maxParallel: 2,
      reduceInstructions: 'Aggregate outputs.',
      items,
    })).toMatchObject({
      plan: {
        maxParallel: 2,
        reduceInstructions: 'Aggregate outputs.',
        items,
      },
      error: null,
    });
  });

  it('reports dependency, duplicate id, non-pending status, and missing reduce errors', () => {
    expect(validateMapReduceDraftPlan({
      reduceInstructions: 'Reduce',
      items: [
        { id: 'item-1', title: 'First', prompt: 'Do first', status: 'pending', dependsOn: ['missing'] },
      ],
    })).toMatchObject({ plan: null, error: "Map Reduce item 'item-1' depends on unknown item 'missing'" });

    expect(validateMapReduceDraftPlan({
      reduceInstructions: 'Reduce',
      items: [
        { id: 'item-1', title: 'First', prompt: 'Do first', status: 'pending' },
        { id: 'item-1', title: 'Duplicate', prompt: 'Do duplicate', status: 'pending' },
      ],
    })).toMatchObject({ plan: null, error: 'Duplicate Map Reduce item id: item-1' });

    expect(validateMapReduceDraftPlan({
      reduceInstructions: 'Reduce',
      items: [
        { id: 'item-1', title: 'First', prompt: 'Do first', status: 'running' },
      ],
    })).toMatchObject({ plan: null, error: "Generated Map Reduce item 'item-1' must have initial status 'pending'" });

    expect(validateMapReduceDraftPlan({
      items: [
        { id: 'item-1', title: 'First', prompt: 'Do first', status: 'pending' },
      ],
    })).toMatchObject({ plan: null, error: 'Map Reduce reduceInstructions is required' });
  });

  it('extracts the newest valid Advanced JSON plan and preserves the previous valid plan when latest output is invalid', () => {
    const firstItems = makeRun().items;
    const refinedItems = [
      { id: 'item-1', title: 'Refined item', prompt: 'Map refined work', status: 'pending' as const },
    ];

    expect(scanMapReducePlanArtifacts([
      {
        role: 'assistant',
        turnIndex: 1,
        content: `Readable plan\n\n\`\`\`json\n${JSON.stringify({ maxParallel: 3, reduceInstructions: 'Reduce first', items: firstItems }, null, 2)}\n\`\`\``,
      },
      {
        role: 'assistant',
        turnIndex: 3,
        content: `Refined plan\n\n\`\`\`json\n${JSON.stringify({ childMode: 'autopilot', sharedInstructions: 'Be safe', maxParallel: 4, reduceInstructions: 'Reduce refined outputs', items: refinedItems }, null, 2)}\n\`\`\``,
      },
    ])).toMatchObject({
      plan: {
        turnIndex: 3,
        childMode: 'autopilot',
        sharedInstructions: 'Be safe',
        maxParallel: 4,
        reduceInstructions: 'Reduce refined outputs',
        items: refinedItems,
      },
      error: null,
    });

    const invalidLatest = scanMapReducePlanArtifacts([
      {
        role: 'assistant',
        turnIndex: 1,
        content: `Readable plan\n\n\`\`\`json\n${JSON.stringify({ maxParallel: 3, reduceInstructions: 'Reduce first', items: firstItems }, null, 2)}\n\`\`\``,
      },
      {
        role: 'assistant',
        turnIndex: 3,
        content: 'I cannot produce a valid plan yet.',
      },
    ]);

    expect(invalidLatest.plan?.items).toEqual(firstItems);
    expect(invalidLatest.error).toMatchObject({
      turnIndex: 3,
      message: 'Assistant output did not include an Advanced JSON Map Reduce plan',
    });
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

    expect(mapHistoryItem.mapReduce).toMatchObject({ phase: 'map' });
    expect(reduceHistoryItem.mapReduce).toMatchObject({ phase: 'reduce' });
  });

  it('accepts generation metadata on ProcessHistoryItem', () => {
    const generationHistoryItem: ProcessHistoryItem = {
      id: 'queue_generation-1',
      type: 'chat',
      status: 'completed',
      title: 'Generate Map Reduce plan',
      startTime: 3,
      mode: 'ask',
      workspaceId: 'ws-1',
      turnCount: 4,
      mapReduce: {
        kind: 'generation',
        workspaceId: 'ws-1',
        generationId: 'map-reduce-gen-1',
        runId: 'map-reduce-run-1',
        childMode: 'autopilot',
        originalRequest: 'Split this work',
        status: 'approved',
        latestItemCount: 1,
        latestPlanTurnIndex: 3,
        latestPlan: {
          turnIndex: 3,
          childMode: 'autopilot',
          sharedInstructions: 'Keep map outputs concise',
          reduceInstructions: 'Aggregate final answer',
          maxParallel: 3,
          items: [
            {
              id: 'item-1',
              title: 'First item',
              prompt: 'Map item one',
              status: 'pending',
            },
          ],
        },
      },
    };

    expect(generationHistoryItem.mapReduce?.kind).toBe('generation');
  });
});
