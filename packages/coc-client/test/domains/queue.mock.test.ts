import { afterEach, describe, expect, it } from 'vitest';
import { CocApiError, CocClient, type EnqueueTaskRequest } from '../../src';
import {
  mockQueuedTask,
  mockQueueListResponse,
  mockQueueStats,
  startMockServer,
  type MockServer,
  type RecordedRequest,
} from '../mock-server';

describe('QueueClient mock server contract', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('serializes read paths with workspace filters and array query values', async () => {
    mock = await startMockServer();
    const queuedTask = mockQueuedTask({
      id: 'task/read',
      repoId: 'repo/with/slashes',
      status: 'queued',
      createdAt: 1770000001000,
    });
    const listResponse = mockQueueListResponse({
      queued: [queuedTask],
      stats: mockQueueStats({ queued: 1, total: 1 }),
    });
    const statsResponse = {
      stats: mockQueueStats({
        isPaused: true,
        pausedRepos: ['repo/with/slashes'],
      }),
    };
    const historyResponse = {
      history: [
        mockQueuedTask({
          id: 'task/completed',
          repoId: 'repo/with/slashes',
          status: 'completed',
          createdAt: 1770000000000,
        }),
      ],
    };
    mock.on('GET', '/api/queue', { body: listResponse });
    mock.on('GET', '/api/queue/stats', { body: statsResponse });
    mock.on('GET', '/api/queue/history', { body: historyResponse });
    mock.on('GET', '/api/queue/repos', { body: { repos: [{ repoId: 'repo/with/slashes', rootPath: 'C:\\repos\\app', isPaused: true, taskCount: 1, queuedCount: 1, runningCount: 0 }] } });
    const client = createClient(mock);

    await expect(client.queue.list({ workspace: 'repo/with/slashes', type: 'chat' })).resolves.toEqual(listResponse);
    await expect(client.queue.stats({ workspace: 'repo/with/slashes' })).resolves.toEqual(statsResponse);
    await expect(client.queue.history({
      workspace: 'repo/with/slashes',
      type: 'chat',
      limit: 25,
      status: ['completed', 'failed'],
    })).resolves.toEqual(historyResponse);
    await expect(client.queue.repos()).resolves.toEqual({
      repos: [{ repoId: 'repo/with/slashes', rootPath: 'C:\\repos\\app', isPaused: true, taskCount: 1, queuedCount: 1, runningCount: 0 }],
    });

    expectGetRequest(mock.requests[0], '/api/queue', {
      workspace: 'repo/with/slashes',
      type: 'chat',
    });
    expectGetRequest(mock.requests[1], '/api/queue/stats', {
      workspace: 'repo/with/slashes',
    });
    expectGetRequest(mock.requests[2], '/api/queue/history', {
      workspace: 'repo/with/slashes',
      type: 'chat',
      limit: '25',
      status: 'completed,failed',
    });
    expectGetRequest(mock.requests[3], '/api/queue/repos');
  });

  it('omits workspace and empty array query parameters for global read calls', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/queue', { body: mockQueueListResponse({ queued: [], stats: mockQueueStats({ queued: 0, total: 0 }) }) });
    mock.on('GET', '/api/queue/stats', { body: { stats: mockQueueStats({ queued: 0, total: 0 }) } });
    mock.on('GET', '/api/queue/history', { body: { history: [] } });
    const client = createClient(mock);

    await client.queue.list();
    await client.queue.stats();
    await client.queue.history({ status: [] });

    expectGetRequest(mock.requests[0], '/api/queue');
    expectGetRequest(mock.requests[1], '/api/queue/stats');
    expectGetRequest(mock.requests[2], '/api/queue/history');
  });

  it('pins mutation methods, paths, query values, and JSON bodies', async () => {
    mock = await startMockServer();
    const createdTask = mockQueuedTask({
      id: 'task/enqueued',
      repoId: 'repo/with/slashes',
      priority: 'high',
      status: 'queued',
    });
    const enqueueResponse = { task: createdTask };
    const pauseResponse = {
      workspace: 'repo/with/slashes',
      paused: true,
      stats: mockQueueStats({ isPaused: true, pausedRepos: ['repo/with/slashes'] }),
    };
    const resumeResponse = {
      workspace: 'repo/with/slashes',
      paused: false,
      stats: mockQueueStats({ isPaused: false, pausedRepos: [] }),
    };
    mock.on('POST', '/api/queue', { status: 201, body: enqueueResponse });
    mock.on('POST', '/api/queue/tasks', { status: 201, body: enqueueResponse });
    mock.on('POST', '/api/queue/pause', { body: pauseResponse });
    mock.on('POST', '/api/queue/resume', { body: resumeResponse });
    mock.on('DELETE', '/api/queue/task%2Fencoded', { body: { cancelled: true } });
    mock.on('POST', '/api/queue/task%2Fencoded/move-to-top', { body: { moved: true, position: 1 } });
    const client = createClient(mock);
    const enqueueRequest: EnqueueTaskRequest = {
      type: 'chat',
      priority: 'high',
      repoId: 'repo/with/slashes',
      folderPath: 'packages/coc-client',
      payload: { prompt: 'Test queue client', tags: ['client', 'queue'] },
      config: { model: 'gpt-5.4', timeoutMs: 120000 },
      displayName: 'Queue client test',
      clientToken: 'token-1',
    };

    await expect(client.queue.enqueue(enqueueRequest)).resolves.toEqual(enqueueResponse);
    await expect(client.queue.enqueueTask(enqueueRequest)).resolves.toEqual(enqueueResponse);
    await expect(client.queue.pause({ repoId: 'repo/with/slashes' })).resolves.toEqual(pauseResponse);
    await expect(client.queue.resume('repo/with/slashes')).resolves.toEqual(resumeResponse);
    await expect(client.queue.cancel('task/encoded', { reason: 'No longer needed' })).resolves.toEqual({ cancelled: true });
    await expect(client.queue.moveToTop('task/encoded')).resolves.toEqual({ moved: true, position: 1 });

    expectJsonRequest(mock.requests[0], 'POST', '/api/queue', enqueueRequest);
    expectJsonRequest(mock.requests[1], 'POST', '/api/queue/tasks', enqueueRequest);
    expectEmptyRequest(mock.requests[2], 'POST', '/api/queue/pause', { repoId: 'repo/with/slashes' });
    expectEmptyRequest(mock.requests[3], 'POST', '/api/queue/resume', { workspace: 'repo/with/slashes' });
    expectJsonRequest(mock.requests[4], 'DELETE', '/api/queue/task%2Fencoded', { reason: 'No longer needed' });
    expectEmptyRequest(mock.requests[5], 'POST', '/api/queue/task%2Fencoded/move-to-top');
  });

  it('encodes task IDs for task detail, image, and resolved-prompt reads', async () => {
    mock = await startMockServer();
    const task = mockQueuedTask({
      id: 'task/with spaces',
      payload: { prompt: 'Line 1\nLine 2', hasImages: true, imagesCount: 1 },
    });
    const imagesResponse = { images: ['data:image/png;base64,AAECAwQ='] };
    const promptResponse = {
      taskId: 'task/with spaces',
      type: 'chat',
      resolvedPrompt: '=== Prompt ===\nLine 1\nLine 2',
      planFileContent: '# Plan\n\nUse typed queue calls.',
    };
    mock.on('GET', '/api/queue/task%2Fwith%20spaces', { body: { task } });
    mock.on('GET', '/api/queue/task%2Fwith%20spaces/images', { body: imagesResponse });
    mock.on('GET', '/api/queue/task%2Fwith%20spaces/resolved-prompt', { body: promptResponse });
    const client = createClient(mock);

    await expect(client.queue.getTask('task/with spaces')).resolves.toEqual({ task });
    await expect(client.queue.images('task/with spaces')).resolves.toEqual(imagesResponse);
    await expect(client.queue.resolvedPrompt('task/with spaces')).resolves.toEqual(promptResponse);

    expectGetRequest(mock.requests[0], '/api/queue/task%2Fwith%20spaces');
    expectGetRequest(mock.requests[1], '/api/queue/task%2Fwith%20spaces/images');
    expectGetRequest(mock.requests[2], '/api/queue/task%2Fwith%20spaces/resolved-prompt');
  });

  it('propagates queue error envelopes as CocApiError instances', async () => {
    mock = await startMockServer();
    mock.on('POST', '/api/queue/pause', {
      status: 409,
      body: {
        error: {
          message: 'Queue is already paused',
          code: 'QUEUE_ALREADY_PAUSED',
          details: { workspace: 'repo-a' },
        },
      },
    });
    mock.on('DELETE', '/api/queue/missing%2Ftask', {
      status: 404,
      body: {
        error: {
          message: 'Task not found',
          code: 'TASK_NOT_FOUND',
          details: { taskId: 'missing/task' },
        },
      },
    });
    mock.on('POST', '/api/queue', {
      status: 400,
      body: {
        error: {
          message: 'Invalid queue task payload',
          code: 'VALIDATION_FAILED',
          details: { fieldErrors: { type: 'Required' } },
        },
      },
    });
    const client = createClient(mock);

    await expect(client.queue.pause('repo-a')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 409,
      message: 'Queue is already paused',
      code: 'QUEUE_ALREADY_PAUSED',
      details: { workspace: 'repo-a' },
    } satisfies Partial<CocApiError>);
    await expect(client.queue.cancel('missing/task')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
      message: 'Task not found',
      code: 'TASK_NOT_FOUND',
      details: { taskId: 'missing/task' },
    } satisfies Partial<CocApiError>);
    await expect(client.queue.enqueue({ type: '', payload: {} })).rejects.toMatchObject({
      name: 'CocApiError',
      status: 400,
      message: 'Invalid queue task payload',
      code: 'VALIDATION_FAILED',
      details: { fieldErrors: { type: 'Required' } },
    } satisfies Partial<CocApiError>);

    expectEmptyRequest(mock.requests[0], 'POST', '/api/queue/pause', { workspace: 'repo-a' });
    expectEmptyRequest(mock.requests[1], 'DELETE', '/api/queue/missing%2Ftask');
    expectJsonRequest(mock.requests[2], 'POST', '/api/queue', { type: '', payload: {} });
  });
});

function createClient(mock: MockServer): CocClient {
  return new CocClient({ baseUrl: mock.url, fetch: globalThis.fetch });
}

function expectGetRequest(request: RecordedRequest, path: string, query: Record<string, string> = {}): void {
  expectEmptyRequest(request, 'GET', path, query);
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
