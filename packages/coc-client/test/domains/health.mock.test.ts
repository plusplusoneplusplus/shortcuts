import { afterEach, describe, expect, it } from 'vitest';
import { CocApiError, CocClient } from '../../src';
import { startMockServer, type MockServer, type RecordedRequest } from '../mock-server';

describe('HealthClient mock server contract', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('gets the health contract shape from /api/health', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/health', {
      body: {
        status: 'ok',
        uptime: 42.5,
        processCount: 3,
      },
    });
    const client = createClient(mock);

    await expect(client.health.get()).resolves.toEqual({
      status: 'ok',
      uptime: 42.5,
      processCount: 3,
    });

    expect(mock.requests).toHaveLength(1);
    expectGetRequest(mock.requests[0], '/api/health');
  });

  it('propagates non-200 health responses as CocApiError', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/health', {
      status: 503,
      body: {
        error: {
          message: 'Health check failed',
          code: 'HEALTH_UNAVAILABLE',
          details: { dependency: 'process-store' },
        },
      },
    });
    const client = createClient(mock);

    await expect(client.health.get()).rejects.toMatchObject({
      name: 'CocApiError',
      status: 503,
      message: 'Health check failed',
      code: 'HEALTH_UNAVAILABLE',
      details: { dependency: 'process-store' },
    } satisfies Partial<CocApiError>);

    expect(mock.requests).toHaveLength(1);
    expectGetRequest(mock.requests[0], '/api/health');
  });

  it('gets OpenAPI JSON even when served with a non-JSON content type', async () => {
    mock = await startMockServer();
    const openApiDocument = {
      openapi: '3.0.0',
      info: { title: 'CoC API', version: 'test' },
      paths: { '/api/health': {} },
    };
    mock.on('GET', '/api/openapi.json', {
      headers: { 'content-type': 'text/plain' },
      rawBody: JSON.stringify(openApiDocument),
    });
    const client = createClient(mock);

    await expect(client.health.openApi()).resolves.toEqual(openApiDocument);

    expect(mock.requests).toHaveLength(1);
    expectGetRequest(mock.requests[0], '/api/openapi.json');
  });

  it('propagates OpenAPI 404 responses as CocApiError', async () => {
    mock = await startMockServer();
    mock.onDefault({
      status: 404,
      body: {
        error: {
          message: 'OpenAPI document not found',
          code: 'NOT_FOUND',
          details: { path: '/api/openapi.json' },
        },
      },
    });
    const client = createClient(mock);

    await expect(client.health.openApi()).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
      message: 'OpenAPI document not found',
      code: 'NOT_FOUND',
      details: { path: '/api/openapi.json' },
    } satisfies Partial<CocApiError>);

    expect(mock.requests).toHaveLength(1);
    expectGetRequest(mock.requests[0], '/api/openapi.json');
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
