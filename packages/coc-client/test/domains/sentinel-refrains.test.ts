import { describe, expect, it, vi } from 'vitest';
import { CocApiError, CocClient, CocNetworkError, SentinelTodosClient } from '../../src';
import type { SentinelRefrain, SentinelRefrainGateTest, SentinelRefrainInput, SentinelRefrainRun } from '../../src';
import { createMockAdapter } from './helpers';

const ownerPath = '/workspaces/ws%20one/sentinel-todos/chat%23one/jobs';

describe('Sentinel scheduled jobs client', () => {
  it('lists all jobs for the owner with optional abort signal', async () => {
    const jobs: SentinelRefrain[] = [
      {
        id: 'job-one',
        name: 'Daily review',
        instructions: 'Review PRs',
        provider: 'copilot',
        model: 'gpt-5.4',
        mode: 'ask',
        enabled: true,
        autoCompactThreshold: 100000,
        revision: 1,
        runs: [],
      },
      {
        id: 'job-two',
        name: 'Weekly summary',
        instructions: 'Summarize work',
        provider: 'copilot',
        model: 'gpt-5.4',
        mode: 'autopilot',
        enabled: false,
        autoCompactThreshold: 50000,
        revision: 2,
        nextRunAt: '2026-10-19T09:00:00Z',
        runs: [],
      },
    ];
    const adapter = createMockAdapter({ jobs });
    const signal = new AbortController().signal;
    expect(await new SentinelTodosClient(adapter).jobs.list('ws one', 'chat#one', { signal })).toEqual({ jobs });
    expect(adapter.calls[0]).toEqual({ path: ownerPath, options: { signal } });
  });

  it('creates a job with required and optional input fields', async () => {
    const input: SentinelRefrainInput = {
      name: 'New job',
      instructions: 'Do something',
      provider: 'copilot',
      model: 'gpt-5.4',
      mode: 'ask',
      enabled: true,
      cron: '0 9 * * *',
      autoCompactThreshold: 100000,
    };
    const created: SentinelRefrain = {
      ...input,
      id: 'job-abc',
      revision: 1,
      runs: [],
    };
    const adapter = createMockAdapter(created);
    const client = new SentinelTodosClient(adapter).jobs;
    const result = await client.create('ws one', 'chat#one', input);
    expect(result).toEqual(created);
    expect(adapter.calls[0]).toEqual({
      path: ownerPath,
      options: { method: 'POST', body: input },
    });
  });

  it('creates a job with minimal input fields', async () => {
    const input: SentinelRefrainInput = {
      name: 'Minimal job',
      instructions: 'Do it',
      provider: 'copilot',
      model: 'gpt-5.4',
    };
    const created: SentinelRefrain = {
      ...input,
      id: 'job-xyz',
      mode: 'ask',
      enabled: true,
      autoCompactThreshold: 100000,
      revision: 1,
      runs: [],
    };
    const adapter = createMockAdapter(created);
    const result = await new SentinelTodosClient(adapter).jobs.create('ws one', 'chat#one', input);
    expect(result).toEqual(created);
  });

  it('updates a job with revision safety guard and partial fields', async () => {
    const updated: SentinelRefrain = {
      id: 'job-one',
      name: 'Updated name',
      instructions: 'Updated instructions',
      provider: 'codex',
      model: 'gpt-5.5',
      mode: 'autopilot',
      enabled: false,
      autoCompactThreshold: 200000,
      revision: 3,
      runs: [],
    };
    const adapter = createMockAdapter(updated);
    const client = new SentinelTodosClient(adapter).jobs;
    const result = await client.update('ws one', 'chat#one', 'job-one', {
      expectedRevision: 2,
      name: 'Updated name',
      mode: 'autopilot',
    });
    expect(result).toEqual(updated);
    expect(adapter.calls[0]).toEqual({
      path: ownerPath + '/job-one',
      options: {
        method: 'PATCH',
        body: {
          expectedRevision: 2,
          name: 'Updated name',
          mode: 'autopilot',
        },
      },
    });
  });

  it('deletes a job with revision confirmation', async () => {
    const adapter = createMockAdapter(undefined);
    const client = new SentinelTodosClient(adapter).jobs;
    const result = await client.delete('ws one', 'chat#one', 'job-one', { expectedRevision: 3 });
    expect(result).toBeDefined();
    expect(adapter.calls[0]).toEqual({
      path: ownerPath + '/job-one',
      options: {
        method: 'DELETE',
        body: { expectedRevision: 3 },
      },
    });
  });

  it('starts a manual job run', async () => {
    const run: SentinelRefrainRun = {
      id: 'run-001',
      runNumber: 1,
      trigger: 'manual',
      status: 'queued',
      createdAt: '2026-10-18T19:27:15Z',
    };
    const adapter = createMockAdapter(run);
    const client = new SentinelTodosClient(adapter).jobs;
    const result = await client.start('ws one', 'chat#one', 'job-one');
    expect(result).toEqual(run);
    expect(adapter.calls[0]).toEqual({
      path: ownerPath + '/job-one/runs',
      options: { method: 'POST' },
    });
  });

  it('returns manual gate skips and preserves gate conflict errors', async () => {
    const skipped: SentinelRefrainRun = { id: 'skip', runNumber: 1, trigger: 'manual',
      status: 'skipped', skipReason: 'gate-empty', createdAt: '2026-10-18T19:27:15Z' };
    const client = new SentinelTodosClient(createMockAdapter(skipped)).jobs;
    expect(await client.start('ws', 'sentinel', 'job')).toEqual(skipped);
    const fetch = vi.fn(async () => Response.json({ code: 'conflict', error: 'Refrain gate is paused' }, { status: 409 }));
    const remote = new CocClient({ baseUrl: 'https://remote.test', fetch });
    await expect(remote.sentinelTodos.jobs.start('ws', 'sentinel', 'job')).rejects.toMatchObject({
      status: 409, message: 'Refrain gate is paused' });
  });

  it('cancels an active job run', async () => {
    const cancelled: SentinelRefrainRun = {
      id: 'run-001',
      runNumber: 1,
      trigger: 'manual',
      status: 'cancelled',
      createdAt: '2026-10-18T19:27:15Z',
      finishedAt: '2026-10-18T19:28:00Z',
      durationMs: 45000,
    };
    const adapter = createMockAdapter(cancelled);
    const client = new SentinelTodosClient(adapter).jobs;
    const result = await client.cancel('ws one', 'chat#one', 'job-one', 'run-001');
    expect(result).toEqual(cancelled);
    expect(adapter.calls[0]).toEqual({
      path: ownerPath + '/job-one/runs/run-001/cancel',
      options: { method: 'POST' },
    });
  });

  it('tests a gate with optional cancellation and resumes it on the owner path', async () => {
    const outcome: SentinelRefrainGateTest = { ok: true, result: '{"items":[1]}', empty: false };
    const adapter = createMockAdapter(outcome);
    const client = new SentinelTodosClient(adapter).jobs;
    const signal = new AbortController().signal;
    expect(await client.testGate('ws one', 'chat#one', 'job/one', { signal })).toEqual(outcome);
    expect(adapter.calls[0]).toEqual({ path: ownerPath + '/job%2Fone/gate/test', options: { signal, method: 'POST' } });
    await client.resumeGate('ws one', 'chat#one', 'job/one');
    expect(adapter.calls[1]).toEqual({ path: ownerPath + '/job%2Fone/gate/resume', options: { method: 'POST' } });
  });

  it('encodes owner, job, and run IDs in path segments', async () => {
    const adapter = createMockAdapter({ jobs: [] });
    const client = new SentinelTodosClient(adapter).jobs;
    
    await client.list('ws one', 'chat#one', {});
    expect(adapter.calls[0].path).toBe('/workspaces/ws%20one/sentinel-todos/chat%23one/jobs');
    
    adapter.calls.length = 0;
    await client.list('ws/path', 'chat?query', {});
    expect(adapter.calls[0].path).toBe('/workspaces/ws%2Fpath/sentinel-todos/chat%3Fquery/jobs');
    
    adapter.calls.length = 0;
    await client.delete('ws', 'chat', 'job/id', { expectedRevision: 1 });
    expect(adapter.calls[0].path).toBe('/workspaces/ws/sentinel-todos/chat/jobs/job%2Fid');
    
    adapter.calls.length = 0;
    await client.cancel('ws', 'chat', 'job#id', 'run?id');
    expect(adapter.calls[0].path).toBe('/workspaces/ws/sentinel-todos/chat/jobs/job%23id/runs/run%3Fid/cancel');
  });

  it('keeps same-named owners on their chosen host across reads and writes', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => Response.json({ jobs: [] }));
    const local = new CocClient({ baseUrl: 'http://local.test', fetch });
    const remote = new CocClient({ baseUrl: 'https://remote.test', fetch });
    
    await local.sentinelTodos.jobs.list('ws-owner', 'chat');
    await remote.sentinelTodos.jobs.list('ws-owner', 'chat');
    await remote.sentinelTodos.jobs.create('group-owner', 'chat', {
      name: 'job', instructions: 'do', provider: 'copilot', model: 'gpt-5',
    });
    await remote.sentinelTodos.jobs.start('group-owner', 'chat', 'job-id');
    
    expect(fetch.mock.calls.map(call => String(call[0]))).toEqual([
      'http://local.test/api/workspaces/ws-owner/sentinel-todos/chat/jobs',
      'https://remote.test/api/workspaces/ws-owner/sentinel-todos/chat/jobs',
      'https://remote.test/api/workspaces/group-owner/sentinel-todos/chat/jobs',
      'https://remote.test/api/workspaces/group-owner/sentinel-todos/chat/jobs/job-id/runs',
    ]);
  });

  it.each([400, 404, 409])('preserves HTTP %s structured errors without retrying a mutation', async status => {
    const body = { error: 'Job already running', code: 'conflict', current: { id: 'job', revision: 5 } };
    const fetch = vi.fn(async () => Response.json(body, { status }));
    const client = new CocClient({ baseUrl: 'https://remote.test', fetch });
    
    const error = await client.sentinelTodos.jobs.create('ws', 'p', {
      name: 'job', instructions: 'do', provider: 'copilot', model: 'gpt-5',
    }).catch(e => e);
    expect(error).toBeInstanceOf(CocApiError);
    expect(error).toMatchObject({ status, code: 'conflict', body });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('error on update due to concurrent modification without retrying', async () => {
    const body = { error: 'Revision mismatch', code: 'conflict' };
    const fetch = vi.fn(async () => Response.json(body, { status: 409 }));
    const client = new CocClient({ baseUrl: 'https://remote.test', fetch });
    
    const error = await client.sentinelTodos.jobs.update('ws', 'p', 'job-id', {
      expectedRevision: 2,
      name: 'New name',
    }).catch(e => e);
    expect(error).toBeInstanceOf(CocApiError);
    expect(error.status).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('error on delete due to concurrent modification without retrying', async () => {
    const body = { error: 'Job revision changed', code: 'conflict' };
    const fetch = vi.fn(async () => Response.json(body, { status: 409 }));
    const client = new CocClient({ baseUrl: 'https://remote.test', fetch });
    
    const error = await client.sentinelTodos.jobs.delete('ws', 'p', 'job-id', {
      expectedRevision: 1,
    }).catch(e => e);
    expect(error).toBeInstanceOf(CocApiError);
    expect(error.status).toBe(409);
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
    
    const error = await client.sentinelTodos.jobs.list('ws', 'p', { signal: controller.signal }).catch(e => e);
    expect(error).toBeInstanceOf(CocNetworkError);
    expect(error).toMatchObject({ code: 'ABORTED', cause: 'owner changed' });
  });

  it('passes write cancellation through the owning transport', async () => {
    const controller = new AbortController();
    controller.abort('user cancelled');
    const fetch = vi.fn(async (_url: unknown, options?: RequestInit) => {
      expect(options?.signal?.aborted).toBe(true);
      throw options?.signal?.reason;
    });
    const client = new CocClient({ baseUrl: 'https://remote.test', fetch });
    
    const error = await client.sentinelTodos.jobs.create('ws', 'p', {
      name: 'job', instructions: 'do', provider: 'copilot', model: 'gpt-5',
    }).catch(e => e);
    expect(error).toBeInstanceOf(CocNetworkError);
  });

  it('job run transitions through state machine: queued -> running -> completed', async () => {
    const queued: SentinelRefrainRun = {
      id: 'run-abc',
      runNumber: 1,
      trigger: 'schedule',
      status: 'queued',
      createdAt: '2026-10-18T09:00:00Z',
    };
    const running: SentinelRefrainRun = {
      ...queued,
      status: 'running',
      startedAt: '2026-10-18T09:01:00Z',
    };
    const completed: SentinelRefrainRun = {
      ...running,
      status: 'completed',
      finishedAt: '2026-10-18T09:05:00Z',
      durationMs: 240000,
      turnIndex: 42,
      jobTurnHref: '/api/processes/job-process-id',
    };
    
    const adapter = createMockAdapter(queued);
    let client = new SentinelTodosClient(adapter).jobs;
    let result = await client.start('ws one', 'chat#one', 'job-one');
    expect(result.status).toBe('queued');
    
    adapter.calls.length = 0;
    Object.assign(adapter, { request: async () => running });
    result = await client.list('ws one', 'chat#one');
    
    Object.assign(adapter, { request: async () => completed });
    adapter.calls.length = 0;
    result = await client.list('ws one', 'chat#one');
  });

  it('skipped run due to overlap conflict has skip reason and no duration', async () => {
    const skipped: SentinelRefrainRun = {
      id: 'run-xyz',
      runNumber: 2,
      trigger: 'schedule',
      status: 'skipped',
      createdAt: '2026-10-18T09:30:00Z',
      skipReason: 'overlap',
    };
    const adapter = createMockAdapter(skipped);
    const client = new SentinelTodosClient(adapter).jobs;
    const result = await client.start('ws one', 'chat#one', 'job-one');
    expect(result).toEqual(skipped);
    expect(result.durationMs).toBeUndefined();
    expect(result.finishedAt).toBeUndefined();
  });

  it('run with error and interrupted status includes error message', async () => {
    const failed: SentinelRefrainRun = {
      id: 'run-fail',
      runNumber: 3,
      trigger: 'manual',
      status: 'failed',
      createdAt: '2026-10-18T10:00:00Z',
      startedAt: '2026-10-18T10:00:01Z',
      finishedAt: '2026-10-18T10:00:05Z',
      durationMs: 4000,
      error: 'Process crashed: out of memory',
    };
    const adapter = createMockAdapter(failed);
    const client = new SentinelTodosClient(adapter).jobs;
    const result = await client.start('ws one', 'chat#one', 'job-one');
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Process crashed: out of memory');
  });

  it('job with active run and process link maintains ledger references', async () => {
    const job: SentinelRefrain = {
      id: 'job-active',
      name: 'Active job',
      instructions: 'Running work',
      provider: 'copilot',
      model: 'gpt-5.4',
      mode: 'autopilot',
      enabled: true,
      autoCompactThreshold: 100000,
      revision: 5,
      processId: 'sentinel-process-xyz',
      nextRunAt: '2026-10-19T09:00:00Z',
      activeRun: {
        id: 'run-active',
        runNumber: 10,
        trigger: 'schedule',
        status: 'running',
        createdAt: '2026-10-18T08:00:00Z',
        startedAt: '2026-10-18T08:01:00Z',
        jobTurnHref: '/api/processes/sentinel-process-xyz/turns/5',
        sentinelFollowUpHref: '/api/processes/sentinel-owner-id/turns/123',
      },
      runs: [
        {
          id: 'run-prev',
          runNumber: 9,
          trigger: 'schedule',
          status: 'completed',
          createdAt: '2026-10-18T07:00:00Z',
          finishedAt: '2026-10-18T07:30:00Z',
          durationMs: 1800000,
        },
      ],
    };
    const adapter = createMockAdapter({ jobs: [job] });
    const client = new SentinelTodosClient(adapter).jobs;
    const result = await client.list('ws one', 'chat#one');
    expect(result.jobs[0]).toEqual(job);
    expect(result.jobs[0].activeRun?.status).toBe('running');
    expect(result.jobs[0].processId).toBe('sentinel-process-xyz');
  });
});
