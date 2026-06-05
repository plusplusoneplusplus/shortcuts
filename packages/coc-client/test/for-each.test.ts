import { describe, expect, it, vi } from 'vitest';
import { CocClient } from '../src';
import type { ForEachRun } from '../src';

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
