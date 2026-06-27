import { describe, expect, it } from 'vitest';
import { TriggersClient, type CreateTriggerRequest, type Trigger } from '../../src';
import { createMockAdapter } from './helpers';

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: 'trigger_1',
    workspaceId: 'repo/a',
    processId: 'queue_proc1',
    status: 'active',
    event: {
      type: 'condition-monitor',
      monitor: 'ci-failure',
      originId: 'origin1',
      prId: '42',
      pollIntervalMs: 60_000,
      lastSeenChecks: {},
    },
    action: { type: 'send-message', processId: 'queue_proc1', prompt: '', mode: 'autopilot' },
    inFlight: false,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    lastTickAt: null,
    nextTickAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe('TriggersClient', () => {
  it('calls create, list, get, status, and delete endpoints with correct paths', async () => {
    const trigger = makeTrigger();
    const adapter = createMockAdapter({ trigger, triggers: [trigger], deleted: true });
    const client = new TriggersClient(adapter);

    const createRequest: CreateTriggerRequest = {
      processId: 'queue_proc1',
      event: { type: 'condition-monitor', monitor: 'ci-failure', originId: 'origin1', prId: '42' },
    };

    await client.create('repo/a', createRequest);
    await client.list('repo/a');
    await client.listAll();
    await client.get('repo/a', 'trigger/1');
    await client.pause('repo/a', 'trigger/1');
    await client.resume('repo/a', 'trigger/1');
    await client.patchStatus('repo/a', 'trigger/1', 'disarmed');
    await client.delete('repo/a', 'trigger/1');

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/workspaces/repo%2Fa/triggers',
      '/workspaces/repo%2Fa/triggers',
      '/triggers',
      '/workspaces/repo%2Fa/triggers/trigger%2F1',
      '/workspaces/repo%2Fa/triggers/trigger%2F1',
      '/workspaces/repo%2Fa/triggers/trigger%2F1',
      '/workspaces/repo%2Fa/triggers/trigger%2F1',
      '/workspaces/repo%2Fa/triggers/trigger%2F1',
    ]);
    expect(adapter.calls[0].options).toMatchObject({ method: 'POST', body: createRequest });
    expect(adapter.calls[4].options).toMatchObject({ method: 'PATCH', body: { status: 'paused' } });
    expect(adapter.calls[5].options).toMatchObject({ method: 'PATCH', body: { status: 'active' } });
    expect(adapter.calls[6].options).toMatchObject({ method: 'PATCH', body: { status: 'disarmed' } });
    expect(adapter.calls[7].options).toMatchObject({ method: 'DELETE' });
  });

  it('unwraps create and list responses', async () => {
    const trigger = makeTrigger({ id: 'trigger_x' });
    const adapter = createMockAdapter({ trigger, triggers: [trigger] });
    const client = new TriggersClient(adapter);

    await expect(client.create('repo-a', {
      processId: 'queue_p',
      event: { type: 'condition-monitor', monitor: 'ci-failure', originId: 'o', prId: '1' },
    })).resolves.toEqual(trigger);
    await expect(client.list('repo-a')).resolves.toEqual([trigger]);
  });

  it('defaults list responses to empty arrays', async () => {
    const adapter = createMockAdapter({});
    const client = new TriggersClient(adapter);

    await expect(client.list('repo-a')).resolves.toEqual([]);
    await expect(client.listAll()).resolves.toEqual([]);
  });
});
