import { afterEach, describe, expect, it } from 'vitest';
import { CocApiError, CocClient, type CreateScheduleRequest, type Schedule, type ScheduleRunRecord, type UpdateScheduleRequest } from '../../src';
import { startMockServer, type MockServer, type RecordedRequest } from '../mock-server';

describe('SchedulesClient mock server contract', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('reads schedule lists and run history with encoded workspace and schedule IDs', async () => {
    mock = await startMockServer();
    const schedule = mockSchedule({ id: 'repo:nightly/check', name: 'Nightly Check' });
    const run = mockRun({ id: 'run-1', scheduleId: schedule.id, status: 'completed' });
    mock.on('GET', '/api/workspaces/repo%2Fwith%2Fslashes/schedules', { body: { schedules: [schedule] } });
    mock.on('GET', '/api/workspaces/repo%2Fwith%2Fslashes/schedules/repo%3Anightly%2Fcheck/history', { body: { history: [run] } });
    const client = createClient(mock);

    await expect(client.schedules.list('repo/with/slashes')).resolves.toEqual([schedule]);
    await expect(client.schedules.history('repo/with/slashes', 'repo:nightly/check')).resolves.toEqual([run]);

    expectEmptyRequest(mock.requests[0], 'GET', '/api/workspaces/repo%2Fwith%2Fslashes/schedules');
    expectEmptyRequest(mock.requests[1], 'GET', '/api/workspaces/repo%2Fwith%2Fslashes/schedules/repo%3Anightly%2Fcheck/history');
  });

  it('pins schedule mutation methods, paths, and JSON bodies', async () => {
    mock = await startMockServer();
    const created = mockSchedule({ id: 'sch-created', name: 'Daily Prompt' });
    const updated = mockSchedule({ ...created, name: 'Updated Prompt', status: 'paused' });
    const run = mockRun({ scheduleId: created.id, taskId: 'task-1', processId: 'queue-task-1' });
    mock.on('POST', '/api/workspaces/ws-1/schedules', { status: 201, body: { schedule: created } });
    mock.on('PATCH', '/api/workspaces/ws-1/schedules/sch-created', { body: { schedule: updated } });
    mock.on('POST', '/api/workspaces/ws-1/schedules/sch-created/move', { body: { schedule: { ...updated, source: 'repo' } } });
    mock.on('POST', '/api/workspaces/ws-1/schedules/sch-created/run', { body: { run } });
    mock.on('DELETE', '/api/workspaces/ws-1/schedules/sch-created', { body: { deleted: true } });
    const client = createClient(mock);
    const createRequest: CreateScheduleRequest = {
      name: 'Daily Prompt',
      target: 'Write a daily summary',
      cron: '0 9 * * *',
      params: { channel: 'status' },
      onFailure: 'notify',
      targetType: 'prompt',
      outputFolder: '~/.coc/repos/ws-1/tasks',
      model: 'gpt-5.4',
      mode: 'autopilot',
    };
    const updateRequest: UpdateScheduleRequest = {
      name: 'Updated Prompt',
      status: 'paused',
      params: { channel: 'triage' },
    };

    await expect(client.schedules.create('ws-1', createRequest)).resolves.toEqual({ schedule: created });
    await expect(client.schedules.update('ws-1', created.id, updateRequest)).resolves.toEqual({ schedule: updated });
    await expect(client.schedules.move('ws-1', created.id, 'repo')).resolves.toEqual({ schedule: { ...updated, source: 'repo' } });
    await expect(client.schedules.run('ws-1', created.id)).resolves.toEqual({ run });
    await expect(client.schedules.delete('ws-1', created.id)).resolves.toEqual({ deleted: true });

    expectJsonRequest(mock.requests[0], 'POST', '/api/workspaces/ws-1/schedules', createRequest);
    expectJsonRequest(mock.requests[1], 'PATCH', '/api/workspaces/ws-1/schedules/sch-created', updateRequest);
    expectJsonRequest(mock.requests[2], 'POST', '/api/workspaces/ws-1/schedules/sch-created/move', { destination: 'repo' });
    expectEmptyRequest(mock.requests[3], 'POST', '/api/workspaces/ws-1/schedules/sch-created/run');
    expectEmptyRequest(mock.requests[4], 'DELETE', '/api/workspaces/ws-1/schedules/sch-created');
  });

  it('uses status helpers and propagates schedule API errors', async () => {
    mock = await startMockServer();
    mock.on('PATCH', '/api/workspaces/ws-1/schedules/missing', {
      status: 404,
      body: {
        error: {
          message: 'Schedule not found',
          code: 'SCHEDULE_NOT_FOUND',
          details: { scheduleId: 'missing' },
        },
      },
    });
    mock.on('PATCH', '/api/workspaces/ws-1/schedules/sch-paused', {
      body: { schedule: mockSchedule({ id: 'sch-paused', status: 'paused' }) },
    });
    mock.on('PATCH', '/api/workspaces/ws-1/schedules/sch-active', {
      body: { schedule: mockSchedule({ id: 'sch-active', status: 'active' }) },
    });
    const client = createClient(mock);

    await expect(client.schedules.update('ws-1', 'missing', { status: 'active' })).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
      message: 'Schedule not found',
      code: 'SCHEDULE_NOT_FOUND',
      details: { scheduleId: 'missing' },
    } satisfies Partial<CocApiError>);
    await expect(client.schedules.disable('ws-1', 'sch-paused')).resolves.toMatchObject({ schedule: { status: 'paused' } });
    await expect(client.schedules.enable('ws-1', 'sch-active')).resolves.toMatchObject({ schedule: { status: 'active' } });

    expectJsonRequest(mock.requests[0], 'PATCH', '/api/workspaces/ws-1/schedules/missing', { status: 'active' });
    expectJsonRequest(mock.requests[1], 'PATCH', '/api/workspaces/ws-1/schedules/sch-paused', { status: 'paused' });
    expectJsonRequest(mock.requests[2], 'PATCH', '/api/workspaces/ws-1/schedules/sch-active', { status: 'active' });
  });
});

function createClient(mock: MockServer): CocClient {
  return new CocClient({ baseUrl: mock.url, fetch: globalThis.fetch });
}

function mockSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sch-1',
    name: 'Schedule',
    target: 'Run scheduled work',
    targetType: 'prompt',
    cron: '0 9 * * *',
    cronDescription: 'Every day at 09:00',
    params: {},
    onFailure: 'notify',
    status: 'active',
    isRunning: false,
    nextRun: '2026-05-02T09:00:00.000Z',
    createdAt: '2026-05-01T09:00:00.000Z',
    ...overrides,
  };
}

function mockRun(overrides: Partial<ScheduleRunRecord> = {}): ScheduleRunRecord {
  return {
    id: 'run-1',
    scheduleId: 'sch-1',
    repoId: 'ws-1',
    startedAt: '2026-05-02T09:00:00.000Z',
    completedAt: '2026-05-02T09:00:01.000Z',
    status: 'completed',
    durationMs: 1000,
    ...overrides,
  };
}

function expectEmptyRequest(
  request: RecordedRequest,
  method: string,
  path: string,
  query: Record<string, string> = {},
): void {
  expect(request).toMatchObject({
    method,
    path,
    query,
    rawBody: '',
    body: undefined,
  });
  expect(request.headers['content-type']).toBeUndefined();
}

function expectJsonRequest(
  request: RecordedRequest,
  method: string,
  path: string,
  body: unknown,
  query: Record<string, string> = {},
): void {
  expect(request).toMatchObject({
    method,
    path,
    query,
    rawBody: JSON.stringify(body),
    body,
  });
  expect(request.headers['content-type']).toBe('application/json');
}
