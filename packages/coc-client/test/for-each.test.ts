import { describe, expect, it, vi } from 'vitest';
import { CocClient, normalizeForEachPlanItems, scanForEachPlanArtifacts, validateForEachDraftPlan } from '../src';
import type { ForEachRun, ProcessHistoryItem } from '../src';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeRun(overrides: Partial<ForEachRun> = {}): ForEachRun {
  return {
    runId: 'run-1',
    workspaceId: 'ws-1',
    status: 'approved',
    originalRequest: 'Split this work',
    childMode: 'ask',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    items: [
      {
        id: 'item-1',
        title: 'First item',
        prompt: 'Do item one',
        status: 'pending',
      },
    ],
    ...overrides,
  };
}

describe('ForEachClient', () => {
  it('creates a reviewed For Each run without invoking the generation endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ run: makeRun({ runId: 'reviewed-run', generationProcessId: 'queue_gen-1' }) }));
    const client = new CocClient({ baseUrl: 'http://localhost:4000', fetch });

    const run = await client.forEach.create('ws/one', {
      originalRequest: 'Split this',
      sharedInstructions: 'Keep changes small',
      childMode: 'ask',
      provider: 'copilot',
      config: { model: 'gpt-5.4', reasoningEffort: 'medium' },
      generationProcessId: 'queue_gen-1',
      generationId: 'for-each-gen-1',
      items: makeRun().items,
    });

    expect(run.runId).toBe('reviewed-run');
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:4000/api/workspaces/ws%2Fone/for-each-runs');
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      originalRequest: 'Split this',
      sharedInstructions: 'Keep changes small',
      childMode: 'ask',
      provider: 'copilot',
      config: { model: 'gpt-5.4', reasoningEffort: 'medium' },
      generationProcessId: 'queue_gen-1',
      generationId: 'for-each-gen-1',
      items: makeRun().items,
    });
  });

  it('generates a For Each run through the workspace-scoped route', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ run: makeRun({ runId: 'generated-run' }) }));
    const client = new CocClient({ baseUrl: 'http://localhost:4000', fetch });

    const run = await client.forEach.generate('ws/one', {
      prompt: 'Split this',
      sharedInstructions: 'Keep changes small',
      childMode: 'autopilot',
      provider: 'codex',
      config: { model: 'gpt-5.3-codex', reasoningEffort: 'high' },
    });

    expect(run.runId).toBe('generated-run');
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:4000/api/workspaces/ws%2Fone/for-each-runs/generate');
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      prompt: 'Split this',
      sharedInstructions: 'Keep changes small',
      childMode: 'autopilot',
      provider: 'codex',
      config: { model: 'gpt-5.3-codex', reasoningEffort: 'high' },
    });
  });

  it('reads, updates, approves, starts, retries, skips, and cancels by run id', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ run: makeRun() })));
    const client = new CocClient({ baseUrl: 'http://localhost:4000', fetch });

    await client.forEach.get('ws-1', 'run/one');
    await client.forEach.updatePlan('ws-1', 'run/one', { items: makeRun().items, childMode: 'ask' });
    await client.forEach.approve('ws-1', 'run/one');
    await client.forEach.start('ws-1', 'run/one');
    await client.forEach.continue('ws-1', 'run/one');
    await client.forEach.retryItem('ws-1', 'run/one', 'item/one');
    await client.forEach.skipItem('ws-1', 'run/one', 'item/one');
    await client.forEach.cancel('ws-1', 'run/one');

    const urls = fetch.mock.calls.map(call => call[0]);
    expect(urls).toEqual([
      'http://localhost:4000/api/workspaces/ws-1/for-each-runs/run%2Fone',
      'http://localhost:4000/api/workspaces/ws-1/for-each-runs/run%2Fone/plan',
      'http://localhost:4000/api/workspaces/ws-1/for-each-runs/run%2Fone/approve',
      'http://localhost:4000/api/workspaces/ws-1/for-each-runs/run%2Fone/start',
      'http://localhost:4000/api/workspaces/ws-1/for-each-runs/run%2Fone/continue',
      'http://localhost:4000/api/workspaces/ws-1/for-each-runs/run%2Fone/items/item%2Fone/retry',
      'http://localhost:4000/api/workspaces/ws-1/for-each-runs/run%2Fone/items/item%2Fone/skip',
      'http://localhost:4000/api/workspaces/ws-1/for-each-runs/run%2Fone/cancel',
    ]);
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'PUT' });
    for (const call of fetch.mock.calls.slice(2)) {
      expect(call[1]).toMatchObject({ method: 'POST' });
    }
  });
});

describe('For Each item-plan validation', () => {
  it('normalizes items and validates dependencies', () => {
    const items = normalizeForEachPlanItems([
      { id: ' item-1 ', title: ' First ', prompt: ' Do first ', status: 'pending' },
      { id: 'item-2', title: 'Second', prompt: 'Do second', status: 'pending', dependsOn: [' item-1 '] },
    ]);

    expect(items).toEqual([
      { id: 'item-1', title: 'First', prompt: 'Do first', status: 'pending' },
      { id: 'item-2', title: 'Second', prompt: 'Do second', status: 'pending', dependsOn: ['item-1'] },
    ]);
  });

  it('reports dependency, duplicate id, and non-pending draft-status errors', () => {
    expect(validateForEachDraftPlan([
      { id: 'item-1', title: 'First', prompt: 'Do first', status: 'pending', dependsOn: ['missing'] },
    ])).toMatchObject({ items: null, error: "Item 'item-1' depends on unknown item 'missing'" });

    expect(validateForEachDraftPlan([
      { id: 'item-1', title: 'First', prompt: 'Do first', status: 'pending' },
      { id: 'item-1', title: 'Duplicate', prompt: 'Do duplicate', status: 'pending' },
    ])).toMatchObject({ items: null, error: 'Duplicate For Each item id: item-1' });

    expect(validateForEachDraftPlan([
      { id: 'item-1', title: 'First', prompt: 'Do first', status: 'running' },
    ])).toMatchObject({ items: null, error: "Generated For Each item 'item-1' must have initial status 'pending'" });
  });

  it('extracts the newest valid Advanced JSON plan and reports invalid latest output without clobbering it', () => {
    const firstItems = makeRun().items;
    const refinedItems = [
      { id: 'item-1', title: 'Refined item', prompt: 'Do refined work', status: 'pending' as const },
    ];

    expect(scanForEachPlanArtifacts([
      {
        role: 'assistant',
        turnIndex: 1,
        content: `Readable plan\n\n\`\`\`json\n${JSON.stringify({ items: firstItems }, null, 2)}\n\`\`\``,
      },
      {
        role: 'assistant',
        turnIndex: 3,
        content: `Refined plan\n\n\`\`\`json\n${JSON.stringify({ childMode: 'autopilot', sharedInstructions: 'Be safe', items: refinedItems }, null, 2)}\n\`\`\``,
      },
    ])).toMatchObject({
      plan: {
        turnIndex: 3,
        childMode: 'autopilot',
        sharedInstructions: 'Be safe',
        items: refinedItems,
      },
      error: null,
    });

    const invalidLatest = scanForEachPlanArtifacts([
      {
        role: 'assistant',
        turnIndex: 1,
        content: `Readable plan\n\n\`\`\`json\n${JSON.stringify({ items: firstItems }, null, 2)}\n\`\`\``,
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
      message: 'Assistant output did not include an Advanced JSON item plan',
    });
  });
});

describe('For Each process history contract', () => {
  it('accepts child and generation metadata on ProcessHistoryItem', () => {
    const childHistoryItem: ProcessHistoryItem = {
      id: 'queue_child-1',
      type: 'chat',
      status: 'completed',
      title: 'Child item',
      startTime: 1,
      mode: 'ask',
      workspaceId: 'ws-1',
      turnCount: 2,
      forEach: {
        kind: 'child',
        workspaceId: 'ws-1',
        runId: 'run-1',
        itemId: 'item-1',
        childMode: 'ask',
      },
    };

    const generationHistoryItem: ProcessHistoryItem = {
      id: 'queue_generation-1',
      type: 'chat',
      status: 'completed',
      title: 'Generate For Each plan',
      startTime: 2,
      mode: 'ask',
      workspaceId: 'ws-1',
      turnCount: 4,
      forEach: {
        kind: 'generation',
        workspaceId: 'ws-1',
        generationId: 'for-each-gen-1',
        runId: 'run-1',
        childMode: 'autopilot',
        originalRequest: 'Split this work',
        status: 'approved',
        latestItemCount: 1,
        latestPlanTurnIndex: 3,
        latestPlan: {
          turnIndex: 3,
          childMode: 'autopilot',
          sharedInstructions: 'Keep changes focused',
          items: [
            {
              id: 'item-1',
              title: 'First item',
              prompt: 'Do item one',
              status: 'pending',
            },
          ],
        },
      },
    };

    expect(childHistoryItem.forEach?.runId).toBe('run-1');
    expect(generationHistoryItem.forEach?.kind).toBe('generation');
  });
});
