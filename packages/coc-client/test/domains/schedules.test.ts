import { describe, expect, it } from 'vitest';
import { SchedulesClient, type CreateScheduleRequest, type UpdateScheduleRequest } from '../../src';
import { createMockAdapter } from './helpers';

describe('SchedulesClient', () => {
  it('calls schedule read, mutation, status, move, run, and history endpoints', async () => {
    const adapter = createMockAdapter({ schedules: [], history: [] });
    const client = new SchedulesClient(adapter);
    const createRequest: CreateScheduleRequest = {
      name: 'Daily Check',
      target: 'Run repo health check',
      cron: '0 9 * * *',
      params: { team: 'platform' },
      targetType: 'prompt',
      mode: 'autopilot',
    };
    const updateRequest: UpdateScheduleRequest = {
      name: 'Updated Check',
      status: 'paused',
    };

    await client.list('repo/a');
    await client.create('repo/a', createRequest);
    await client.update('repo/a', 'schedule/1', updateRequest);
    await client.disable('repo/a', 'schedule/1');
    await client.enable('repo/a', 'schedule/1');
    await client.move('repo/a', 'schedule/1', 'repo');
    await client.run('repo/a', 'schedule/1');
    await client.history('repo/a', 'schedule/1');
    await client.delete('repo/a', 'schedule/1');

    expect(adapter.calls.map(c => c.path)).toEqual([
      '/workspaces/repo%2Fa/schedules',
      '/workspaces/repo%2Fa/schedules',
      '/workspaces/repo%2Fa/schedules/schedule%2F1',
      '/workspaces/repo%2Fa/schedules/schedule%2F1',
      '/workspaces/repo%2Fa/schedules/schedule%2F1',
      '/workspaces/repo%2Fa/schedules/schedule%2F1/move',
      '/workspaces/repo%2Fa/schedules/schedule%2F1/run',
      '/workspaces/repo%2Fa/schedules/schedule%2F1/history',
      '/workspaces/repo%2Fa/schedules/schedule%2F1',
    ]);
    expect(adapter.calls[1].options).toMatchObject({ method: 'POST', body: createRequest });
    expect(adapter.calls[2].options).toMatchObject({ method: 'PATCH', body: updateRequest });
    expect(adapter.calls[3].options).toMatchObject({ method: 'PATCH', body: { status: 'paused' } });
    expect(adapter.calls[4].options).toMatchObject({ method: 'PATCH', body: { status: 'active' } });
    expect(adapter.calls[5].options).toMatchObject({ method: 'POST', body: { destination: 'repo' } });
    expect(adapter.calls[6].options).toMatchObject({ method: 'POST' });
    expect(adapter.calls[8].options).toMatchObject({ method: 'DELETE' });
  });

  it('posts instruction-refine requests with signal/timeout passthrough', async () => {
    const adapter = createMockAdapter({ refined: 'Cleaner instructions.', raw: 'Cleaner instructions.' });
    const client = new SchedulesClient(adapter);
    const controller = new AbortController();

    const result = await client.refine(
      'repo/a',
      { instructions: 'rough notes', hint: 'be specific', model: 'opus' },
      { signal: controller.signal, timeoutMs: 5000 },
    );

    expect(result).toEqual({ refined: 'Cleaner instructions.', raw: 'Cleaner instructions.' });
    expect(adapter.calls[0].path).toBe('/workspaces/repo%2Fa/schedules/refine');
    expect(adapter.calls[0].options).toMatchObject({
      method: 'POST',
      body: { instructions: 'rough notes', hint: 'be specific', model: 'opus' },
      signal: controller.signal,
      timeoutMs: 5000,
    });
  });

  it('unwraps list and history response arrays with empty-array defaults', async () => {
    const adapter = createMockAdapter({});
    const client = new SchedulesClient(adapter);

    await expect(client.list('repo-a')).resolves.toEqual([]);
    await expect(client.history('repo-a', 'schedule-a')).resolves.toEqual([]);
  });
});
