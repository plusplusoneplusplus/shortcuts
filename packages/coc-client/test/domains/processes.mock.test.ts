import { afterEach, describe, expect, it, vi } from 'vitest';
import { CocApiError, CocClient, type CreateProcessRequest, type ProcessMessageRequest } from '../../src';
import { startMockServer, type MockServer, type RecordedRequest, mockProcess, mockProcessDetailResponse, mockProcessListResponse } from '../mock-server';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(readonly url: string, readonly init?: EventSourceInit) {
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }
}

describe('ProcessesClient mock server contract', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
    FakeEventSource.instances = [];
    vi.restoreAllMocks();
  });

  it('serializes list filters and omits empty array filters', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/processes', { body: mockProcessListResponse() });
    const client = createClient(mock);

    await expect(client.processes.list({
      workspace: 'repo/with/slashes',
      status: ['running', 'queued'],
      exclude: ['conversation', 'toolCalls'],
      limit: 25,
      offset: 50,
      since: '2026-05-02T00:00:00.000Z',
      q: 'needle text',
      archived: false,
    })).resolves.toEqual(mockProcessListResponse());

    expect(mock.requests).toHaveLength(1);
    expectGetRequest(mock.requests[0], '/api/processes', {
      workspace: 'repo/with/slashes',
      status: 'running,queued',
      exclude: 'conversation,toolCalls',
      limit: '25',
      offset: '50',
      since: '2026-05-02T00:00:00.000Z',
      q: 'needle text',
      archived: 'false',
    });

    await client.processes.list({ status: [], exclude: [], archived: undefined });

    expect(mock.requests).toHaveLength(2);
    expectGetRequest(mock.requests[1], '/api/processes');
  });

  it('serializes archived true distinctly from archived false', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/processes', { body: mockProcessListResponse([]) });
    const client = createClient(mock);

    await client.processes.list({ archived: true });
    await client.processes.list({ archived: false });
    await client.processes.list({ archived: undefined });

    expect(mock.requests.map(request => request.query)).toEqual([
      { archived: 'true' },
      { archived: 'false' },
      {},
    ]);
  });

  it('serializes summaries filters with encoded workspace IDs', async () => {
    mock = await startMockServer();
    const response = {
      summaries: [{ id: 'proc-1', status: 'running', promptPreview: 'Working' }],
      total: 1,
      limit: 10,
      offset: 5,
    };
    mock.on('GET', '/api/processes/summaries', { body: response });
    const client = createClient(mock);

    await expect(client.processes.summaries({
      workspace: 'repo/with/slashes',
      status: 'completed',
      limit: 10,
      offset: 5,
      q: 'summary query',
      archived: true,
    })).resolves.toEqual(response);

    expectGetRequest(mock.requests[0], '/api/processes/summaries', {
      workspace: 'repo/with/slashes',
      status: 'completed',
      limit: '10',
      offset: '5',
      q: 'summary query',
      archived: 'true',
    });
  });

  it('searches conversations with workspace, status, type, and pagination filters', async () => {
    mock = await startMockServer();
    const response = {
      results: [{
        processId: 'proc-1',
        turnIndex: 0,
        role: 'user',
        snippet: '<mark>needle</mark>',
        rank: -1.25,
        promptPreview: 'Find needle',
        processStatus: 'completed',
        processType: 'chat',
        workspaceId: 'repo/with/slashes',
        startTime: '2026-05-02T00:00:00.000Z',
      }],
      total: 1,
      query: 'needle',
      limit: 5,
      offset: 10,
    };
    mock.on('GET', '/api/processes/search', { body: response });
    const client = createClient(mock);

    await expect(client.processes.search({
      q: 'needle',
      workspace: 'repo/with/slashes',
      status: ['completed', 'failed'],
      type: 'chat',
      limit: 5,
      offset: 10,
    })).resolves.toEqual(response);

    expectGetRequest(mock.requests[0], '/api/processes/search', {
      q: 'needle',
      workspace: 'repo/with/slashes',
      status: 'completed,failed',
      type: 'chat',
      limit: '5',
      offset: '10',
    });
  });

  it('gets process details with encoded IDs, workspace query, and 404 errors', async () => {
    mock = await startMockServer();
    const detail = mockProcessDetailResponse(mockProcess({ id: 'proc/with/slashes' }));
    mock.on('GET', '/api/processes/proc%2Fwith%2Fslashes', { body: detail });
    mock.on('GET', '/api/processes/missing%2Fprocess', {
      status: 404,
      body: {
        error: {
          message: 'Process not found',
          code: 'NOT_FOUND',
          details: { processId: 'missing/process' },
        },
      },
    });
    const client = createClient(mock);

    await expect(client.processes.get('proc/with/slashes', { workspace: 'repo/with/slashes', exclude: 'conversation' })).resolves.toEqual(detail);
    await expect(client.processes.get('missing/process')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
      message: 'Process not found',
      code: 'NOT_FOUND',
      details: { processId: 'missing/process' },
    } satisfies Partial<CocApiError>);

    expectGetRequest(mock.requests[0], '/api/processes/proc%2Fwith%2Fslashes', {
      workspace: 'repo/with/slashes',
      exclude: 'conversation',
    });
    expectGetRequest(mock.requests[1], '/api/processes/missing%2Fprocess');
  });

  it('creates processes with a JSON body and returns the server response', async () => {
    mock = await startMockServer();
    const created = mockProcess({ id: 'created-process', status: 'queued' });
    mock.on('POST', '/api/processes', request => ({
      body: {
        ...created,
        id: (request.body as CreateProcessRequest).id,
      },
    }));
    const client = createClient(mock);
    const input: CreateProcessRequest = {
      id: 'new-process',
      type: 'chat',
      promptPreview: 'Create me',
      status: 'queued',
      startTime: '2026-05-02T00:00:00.000Z',
      workspaceId: 'repo-a',
    };

    await expect(client.processes.create(input)).resolves.toMatchObject({ id: 'new-process' });

    expectJsonRequest(mock.requests[0], 'POST', '/api/processes', input);
  });

  it('passes create payloads through without client-side required-field validation', async () => {
    mock = await startMockServer();
    mock.on('POST', '/api/processes', { body: mockProcess({ id: 'server-decides' }) });
    const client = createClient(mock);

    await client.processes.create({} as CreateProcessRequest);

    expectJsonRequest(mock.requests[0], 'POST', '/api/processes', {});
  });

  it('updates and deletes processes with encoded IDs and workspace query', async () => {
    mock = await startMockServer();
    const updated = mockProcess({ id: 'proc/with/slashes', title: 'Updated title' });
    mock.on('PATCH', '/api/processes/proc%2Fwith%2Fslashes', { body: { process: updated } });
    mock.on('DELETE', '/api/processes/proc%2Fwith%2Fslashes', { noContent: true });
    const client = createClient(mock);

    await expect(client.processes.update('proc/with/slashes', { title: 'Updated title' }, { workspace: 'repo/with/slashes' })).resolves.toEqual({ process: updated });
    await expect(client.processes.delete('proc/with/slashes', { workspace: 'repo/with/slashes' })).resolves.toBeUndefined();

    expectJsonRequest(mock.requests[0], 'PATCH', '/api/processes/proc%2Fwith%2Fslashes', { title: 'Updated title' }, {
      workspace: 'repo/with/slashes',
    });
    expect(mock.requests[1]).toMatchObject({
      method: 'DELETE',
      path: '/api/processes/proc%2Fwith%2Fslashes',
      query: { workspace: 'repo/with/slashes' },
      rawBody: '',
      body: undefined,
    });
    expect(mock.requests[1].headers['content-type']).toBeUndefined();
  });

  it('cancels processes with POST and propagates cancel errors', async () => {
    mock = await startMockServer();
    const cancelled = mockProcess({ id: 'proc/with/slashes', status: 'cancelled' });
    mock.on('POST', '/api/processes/proc%2Fwith%2Fslashes/cancel', { body: { process: cancelled } });
    mock.on('POST', '/api/processes/missing%2Fprocess/cancel', {
      status: 404,
      body: {
        error: {
          message: 'Process not found',
          code: 'NOT_FOUND',
        },
      },
    });
    const client = createClient(mock);

    await expect(client.processes.cancel('proc/with/slashes', { workspace: 'repo/with/slashes' })).resolves.toEqual({ process: cancelled });
    await expect(client.processes.cancel('missing/process')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
      message: 'Process not found',
      code: 'NOT_FOUND',
    } satisfies Partial<CocApiError>);

    expect(mock.requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/processes/proc%2Fwith%2Fslashes/cancel',
      query: { workspace: 'repo/with/slashes' },
      rawBody: '',
      body: undefined,
    });
    expect(mock.requests[0].headers['content-type']).toBeUndefined();
    expect(mock.requests[1].path).toBe('/api/processes/missing%2Fprocess/cancel');
  });

  it.each(['enqueue', 'immediate', 'steer'] as const)('sends %s follow-up messages as JSON', async deliveryMode => {
    mock = await startMockServer();
    const response = {
      processId: 'proc-1',
      turnIndex: deliveryMode === 'steer' ? 0 : -1,
      ...(deliveryMode === 'enqueue'
        ? { pendingMessage: { id: 'pending-1', content: 'hello', createdAt: '2026-05-02T00:00:00.000Z' } }
        : {}),
    };
    mock.on('POST', '/api/processes/proc%2F1/message', { body: response });
    const client = createClient(mock);
    const payload: ProcessMessageRequest = {
      content: 'hello',
      deliveryMode,
      mode: 'ask',
      skillNames: ['impl'],
      model: 'gpt-test',
    };

    await expect(client.processes.sendMessage('proc/1', payload, { workspace: 'repo/with/slashes' })).resolves.toEqual(response);

    expectJsonRequest(mock.requests[0], 'POST', '/api/processes/proc%2F1/message', payload, {
      workspace: 'repo/with/slashes',
    });
  });

  it('propagates sendMessage conflicts as CocApiError', async () => {
    mock = await startMockServer();
    mock.on('POST', '/api/processes/proc-1/message', {
      status: 409,
      body: {
        error: {
          message: 'Process is in a terminal state',
          code: 'CONFLICT',
          details: { status: 'completed' },
        },
      },
    });
    const client = createClient(mock);

    await expect(client.processes.sendMessage('proc-1', { content: 'again', deliveryMode: 'enqueue' })).rejects.toMatchObject({
      name: 'CocApiError',
      status: 409,
      message: 'Process is in a terminal state',
      code: 'CONFLICT',
      details: { status: 'completed' },
    } satisfies Partial<CocApiError>);
  });

  it('serializes turn actions, pinned turn reads, resume launches, and forks', async () => {
    mock = await startMockServer();
    const forked = mockProcess({ id: 'forked-process' });
    mock.on('DELETE', '/api/processes/proc%2F1/turns/2', { body: { id: 'proc/1', turnIndex: 2, deletedAt: '2026-05-02T00:00:00.000Z' } });
    mock.on('PATCH', '/api/processes/proc%2F1/turns/2/restore', { body: { id: 'proc/1', turnIndex: 2, deletedAt: null } });
    mock.on('PATCH', '/api/processes/proc%2F1/turns/2/pin', { body: { id: 'proc/1', turnIndex: 2, pinnedAt: '2026-05-02T00:00:00.000Z', archived: false } });
    mock.on('PATCH', '/api/processes/proc%2F1/turns/2/archive', { body: { id: 'proc/1', turnIndex: 2, archived: true } });
    mock.on('GET', '/api/processes/proc%2F1/turns/pinned', { body: { turns: [{ role: 'assistant', content: 'keep', timestamp: '2026-05-02T00:00:00.000Z', turnIndex: 2 }] } });
    mock.on('POST', '/api/processes/proc%2F1/resume-cli', { body: { launched: false, command: 'copilot resume abc' } });
    mock.on('POST', '/api/processes/proc%2F1/fork', { status: 201, body: { process: forked } });
    const client = createClient(mock);

    await expect(client.processes.deleteTurn('proc/1', 2)).resolves.toMatchObject({ turnIndex: 2 });
    await expect(client.processes.restoreTurn('proc/1', 2)).resolves.toMatchObject({ deletedAt: null });
    await expect(client.processes.pinTurn('proc/1', 2, true)).resolves.toMatchObject({ archived: false });
    await expect(client.processes.archiveTurn('proc/1', 2, true)).resolves.toMatchObject({ archived: true });
    await expect(client.processes.pinnedTurns('proc/1')).resolves.toMatchObject({ turns: [expect.objectContaining({ turnIndex: 2 })] });
    await expect(client.processes.resumeCli('proc/1')).resolves.toEqual({ launched: false, command: 'copilot resume abc' });
    await expect(client.processes.fork('proc/1', { workspace: 'repo/a' })).resolves.toEqual({ process: forked });

    expect(mock.requests.map(request => request.path)).toEqual([
      '/api/processes/proc%2F1/turns/2',
      '/api/processes/proc%2F1/turns/2/restore',
      '/api/processes/proc%2F1/turns/2/pin',
      '/api/processes/proc%2F1/turns/2/archive',
      '/api/processes/proc%2F1/turns/pinned',
      '/api/processes/proc%2F1/resume-cli',
      '/api/processes/proc%2F1/fork',
    ]);
    expectJsonRequest(mock.requests[1], 'PATCH', '/api/processes/proc%2F1/turns/2/restore', {});
    expectJsonRequest(mock.requests[2], 'PATCH', '/api/processes/proc%2F1/turns/2/pin', { pinned: true });
    expectJsonRequest(mock.requests[3], 'PATCH', '/api/processes/proc%2F1/turns/2/archive', { archived: true });
    expectJsonRequest(mock.requests[6], 'POST', '/api/processes/proc%2F1/fork', {}, { workspace: 'repo/a' });
  });

  it('reads output text fallback and serializes range and offset query params', async () => {
    mock = await startMockServer();
    const markdown = '# Conversation output\n\nHello.';
    mock.on('GET', '/api/processes/proc%2F1/output', {
      headers: { 'content-type': 'text/markdown' },
      rawBody: markdown,
    });
    const client = createClient(mock);

    await expect(client.processes.output('proc/1', {
      workspace: 'repo/with/slashes',
      range: 'bytes=0-128',
      offset: 42,
    })).resolves.toBe(markdown);

    expectGetRequest(mock.requests[0], '/api/processes/proc%2F1/output', {
      workspace: 'repo/with/slashes',
      range: 'bytes=0-128',
      offset: '42',
    });
  });

  it('creates process streams with the configured EventSource constructor and encoded query', () => {
    const client = new CocClient({
      baseUrl: 'http://localhost:4000',
      fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch,
      EventSource: FakeEventSource,
    });
    const onEvent = vi.fn();

    const stream = client.processes.stream('proc/with/slashes', {
      workspaceId: 'repo/with/slashes',
      onEvent,
    });

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('http://localhost:4000/api/processes/proc%2Fwith%2Fslashes/stream?workspace=repo%2Fwith%2Fslashes');
    expect(FakeEventSource.instances[0].init).toBeUndefined();

    stream.close();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it('sends ask-user responses with answer and propagates 404 on unknown questions', async () => {
    mock = await startMockServer();
    mock.on('POST', '/api/processes/proc%2F1/ask-user-response', { body: { ok: true } });
    mock.on('POST', '/api/processes/proc%2F2/ask-user-response', {
      status: 404,
      body: {
        error: {
          message: 'Question batch not found or already answered',
          code: 'NOT_FOUND',
        },
      },
    });
    const client = createClient(mock);

    await expect(client.processes.askUserResponse('proc/1', { batchId: 'b-1', answers: [{ questionId: 'q-1', answer: 'yes' }] })).resolves.toEqual({ ok: true });
    await expect(client.processes.askUserResponse('proc/1', { batchId: 'b-2', answers: [{ questionId: 'q-2', skipped: true }] })).resolves.toEqual({ ok: true });
    await expect(client.processes.askUserResponse('proc/2', { batchId: 'b-3', answers: [{ questionId: 'q-3', answer: 'no' }] })).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
      message: 'Question batch not found or already answered',
      code: 'NOT_FOUND',
    } satisfies Partial<CocApiError>);

    expectJsonRequest(mock.requests[0], 'POST', '/api/processes/proc%2F1/ask-user-response', { batchId: 'b-1', answers: [{ questionId: 'q-1', answer: 'yes' }] });
    expectJsonRequest(mock.requests[1], 'POST', '/api/processes/proc%2F1/ask-user-response', { batchId: 'b-2', answers: [{ questionId: 'q-2', skipped: true }] });
    expectJsonRequest(mock.requests[2], 'POST', '/api/processes/proc%2F2/ask-user-response', { batchId: 'b-3', answers: [{ questionId: 'q-3', answer: 'no' }] });
  });

  it('pins and unpins a process', async () => {
    mock = await startMockServer();
    const process = mockProcess({ id: 'proc/1' });
    mock.on('PATCH', '/api/processes/proc%2F1/pin', { body: { process } });
    const client = createClient(mock);

    await expect(client.processes.pin('proc/1', true)).resolves.toEqual({ process });
    expectJsonRequest(mock.requests[0], 'PATCH', '/api/processes/proc%2F1/pin', { pinned: true });

    await expect(client.processes.pin('proc/1', false)).resolves.toEqual({ process });
    expectJsonRequest(mock.requests[1], 'PATCH', '/api/processes/proc%2F1/pin', { pinned: false });
  });

  it('archives and unarchives a process', async () => {
    mock = await startMockServer();
    const process = mockProcess({ id: 'proc/1' });
    mock.on('PATCH', '/api/processes/proc%2F1/archive', { body: { process } });
    const client = createClient(mock);

    await expect(client.processes.archive('proc/1', true)).resolves.toEqual({ process });
    expectJsonRequest(mock.requests[0], 'PATCH', '/api/processes/proc%2F1/archive', { archived: true });

    await expect(client.processes.archive('proc/1', false)).resolves.toEqual({ process });
    expectJsonRequest(mock.requests[1], 'PATCH', '/api/processes/proc%2F1/archive', { archived: false });
  });

  it('batch archives and unarchives processes', async () => {
    mock = await startMockServer();
    mock.on('POST', '/api/processes/archive', { status: 204 });
    mock.on('POST', '/api/processes/unarchive', { status: 204 });
    const client = createClient(mock);

    await client.processes.archiveBatch(['id-1', 'id/2']);
    expectJsonRequest(mock.requests[0], 'POST', '/api/processes/archive', { ids: ['id-1', 'id/2'] });

    await client.processes.unarchiveBatch(['id-3']);
    expectJsonRequest(mock.requests[1], 'POST', '/api/processes/unarchive', { ids: ['id-3'] });
  });

  it('lists, pins, and unpins process groups with workspace-scoped encoded paths', async () => {
    mock = await startMockServer();
    const pins = {
      pins: [
        { type: 'ralph-session' as const, groupId: 'ralph/1', pinnedAt: '2026-06-01T00:00:00.000Z' },
        { type: 'for-each-run' as const, groupId: 'run-1', pinnedAt: '2026-06-01T00:01:00.000Z' },
      ],
    };
    mock.on('GET', '/api/workspaces/repo%2F1/group-pins', { body: pins });
    mock.on('PATCH', '/api/workspaces/repo%2F1/group-pins/ralph-session/ralph%2F1', request => ({
      body: (request.body as { pinned: boolean }).pinned
        ? { pin: pins.pins[0] }
        : { pin: null },
    }));
    mock.on('PATCH', '/api/workspaces/repo%2F1/group-pins/for-each-run/run%2F1', request => ({
      body: (request.body as { pinned: boolean }).pinned
        ? { pin: pins.pins[1] }
        : { pin: null },
    }));
    const client = createClient(mock);

    await expect(client.processes.listGroupPins('repo/1')).resolves.toEqual(pins);
    await expect(client.processes.pinGroup('repo/1', 'ralph-session', 'ralph/1', true)).resolves.toEqual({ pin: pins.pins[0] });
    await expect(client.processes.pinGroup('repo/1', 'ralph-session', 'ralph/1', false)).resolves.toEqual({ pin: null });
    await expect(client.processes.pinGroup('repo/1', 'for-each-run', 'run/1', true)).resolves.toEqual({ pin: pins.pins[1] });
    await expect(client.processes.pinGroup('repo/1', 'for-each-run', 'run/1', false)).resolves.toEqual({ pin: null });

    expectGetRequest(mock.requests[0], '/api/workspaces/repo%2F1/group-pins');
    expectJsonRequest(mock.requests[1], 'PATCH', '/api/workspaces/repo%2F1/group-pins/ralph-session/ralph%2F1', { pinned: true });
    expectJsonRequest(mock.requests[2], 'PATCH', '/api/workspaces/repo%2F1/group-pins/ralph-session/ralph%2F1', { pinned: false });
    expectJsonRequest(mock.requests[3], 'PATCH', '/api/workspaces/repo%2F1/group-pins/for-each-run/run%2F1', { pinned: true });
    expectJsonRequest(mock.requests[4], 'PATCH', '/api/workspaces/repo%2F1/group-pins/for-each-run/run%2F1', { pinned: false });
  });
});

function createClient(mock: MockServer): CocClient {
  return new CocClient({ baseUrl: mock.url, fetch: globalThis.fetch });
}

function expectGetRequest(request: RecordedRequest, path: string, query: Record<string, string> = {}): void {
  expect(request).toMatchObject({
    method: 'GET',
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
