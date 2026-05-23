import { afterEach, describe, expect, it } from 'vitest';
import { CocApiError, CocClient } from '../../src';
import { startMockServer, type MockServer, type RecordedRequest } from '../mock-server';

describe('ModelsClient mock server contract', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('lists models with GET /api/models', async () => {
    mock = await startMockServer();
    const models = [
      { id: 'gpt-5.4', label: 'GPT 5.4', enabled: true },
      { id: 'claude-sonnet-4.6', label: 'Claude Sonnet 4.6', enabled: false },
    ];
    mock.on('GET', '/api/models', { body: models });
    const client = createClient(mock);

    await expect(client.models.list()).resolves.toEqual(models);

    expect(mock.requests).toHaveLength(1);
    expectGetRequest(mock.requests[0], '/api/models');
  });

  it('gets enabled models with GET /api/models/enabled', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/models/enabled', { body: { enabledModels: ['gpt-5.4'] } });
    const client = createClient(mock);

    await expect(client.models.getEnabled()).resolves.toEqual({ enabledModels: ['gpt-5.4'] });

    expect(mock.requests).toHaveLength(1);
    expectGetRequest(mock.requests[0], '/api/models/enabled');
  });

  it('sets enabled models with a JSON PUT body', async () => {
    mock = await startMockServer();
    mock.on('PUT', '/api/models/enabled', request => ({
      body: { enabledModels: (request.body as { enabledModels: string[] }).enabledModels },
    }));
    const client = createClient(mock);

    await expect(client.models.setEnabled(['gpt-5.4', 'claude-sonnet-4.6'])).resolves.toEqual({
      enabledModels: ['gpt-5.4', 'claude-sonnet-4.6'],
    });

    expect(mock.requests).toHaveLength(1);
    expectPutRequest(mock.requests[0], { enabledModels: ['gpt-5.4', 'claude-sonnet-4.6'] });
  });

  it('queries a model with a JSON POST body', async () => {
    mock = await startMockServer();
    const response = {
      success: true,
      response: 'pong',
      model: 'model-a',
      sessionId: 'sess-1',
      durationMs: 42,
    };
    mock.on('POST', '/api/models/query', { body: response });
    const client = createClient(mock);

    await expect(client.models.query({ prompt: 'ping', model: 'model-a', timeoutMs: 5000 })).resolves.toEqual(response);

    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/models/query',
      query: {},
      rawBody: JSON.stringify({ prompt: 'ping', model: 'model-a', timeoutMs: 5000 }),
      body: { prompt: 'ping', model: 'model-a', timeoutMs: 5000 },
    });
    expect(mock.requests[0].headers['content-type']).toBe('application/json');
  });

  it('sends an empty enabled models array without suppressing the request', async () => {
    mock = await startMockServer();
    mock.on('PUT', '/api/models/enabled', { body: { enabledModels: [] } });
    const client = createClient(mock);

    await expect(client.models.setEnabled([])).resolves.toEqual({ enabledModels: [] });

    expect(mock.requests).toHaveLength(1);
    expectPutRequest(mock.requests[0], { enabledModels: [] });
  });

  it('propagates validation details from 422 responses', async () => {
    mock = await startMockServer();
    mock.on('PUT', '/api/models/enabled', {
      status: 422,
      body: {
        error: {
          message: 'Invalid enabled models',
          code: 'VALIDATION_ERROR',
          details: { enabledModels: ['Unknown model id: missing-model'] },
        },
      },
    });
    const client = createClient(mock);

    await expect(client.models.setEnabled(['missing-model'])).rejects.toMatchObject({
      name: 'CocApiError',
      status: 422,
      message: 'Invalid enabled models',
      code: 'VALIDATION_ERROR',
      details: { enabledModels: ['Unknown model id: missing-model'] },
    } satisfies Partial<CocApiError>);

    expect(mock.requests).toHaveLength(1);
    expectPutRequest(mock.requests[0], { enabledModels: ['missing-model'] });
  });

  it('does not cache or share state across concurrent list calls', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/models', [
      { body: [{ id: 'first-model' }] },
      { body: [{ id: 'second-model' }] },
    ]);
    const client = createClient(mock);

    await expect(Promise.all([
      client.models.list(),
      client.models.list(),
    ])).resolves.toEqual([
      [{ id: 'first-model' }],
      [{ id: 'second-model' }],
    ]);

    expect(mock.requests).toHaveLength(2);
    expectGetRequest(mock.requests[0], '/api/models');
    expectGetRequest(mock.requests[1], '/api/models');
  });
});

function createClient(mock: MockServer): CocClient {
  return new CocClient({ baseUrl: mock.url, fetch: globalThis.fetch });
}

function expectGetRequest(request: RecordedRequest, path: string): void {
  expect(request).toMatchObject({
    method: 'GET',
    path,
    query: {},
    rawBody: '',
    body: undefined,
  });
  expect(request.headers['content-type']).toBeUndefined();
}

function expectPutRequest(request: RecordedRequest, body: { enabledModels: string[] }): void {
  expect(request).toMatchObject({
    method: 'PUT',
    path: '/api/models/enabled',
    query: {},
    rawBody: JSON.stringify(body),
    body,
  });
  expect(request.headers['content-type']).toBe('application/json');
}
