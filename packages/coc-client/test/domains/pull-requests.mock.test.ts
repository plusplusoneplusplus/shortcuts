import { afterEach, describe, expect, it, vi } from 'vitest';
import { CocApiError, CocClient } from '../../src';
import {
  startMockServer,
  type MockServer,
  type RecordedRequest,
} from '../mock-server';

describe('PullRequestsClient mock coverage', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('reads sanitized provider config without exposing credentials', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/providers/config', {
      body: {
        providers: {
          github: { hasToken: true },
          ado: { orgUrl: 'https://dev.azure.com/org' },
          tavily: { hasApiKey: false },
        },
      },
    });
    const client = createClient(mock);

    await expect(client.pullRequests.getProviderConfig()).resolves.toEqual({
      providers: {
        github: { hasToken: true },
        ado: { orgUrl: 'https://dev.azure.com/org' },
        tavily: { hasApiKey: false },
      },
    });

    expectEmptyRequest(mock.requests[0], 'GET', '/api/providers/config');
  });

  it('saves provider config as JSON and returns undefined for 204 responses', async () => {
    mock = await startMockServer();
    mock.on('PUT', '/api/providers/config', { status: 204, body: undefined });
    const client = createClient(mock);

    await expect(client.pullRequests.saveProviderConfig({
      ado: { orgUrl: 'https://dev.azure.com/org', token: 'ado-token' },
    })).resolves.toBeUndefined();

    expectJsonRequest(mock.requests[0], 'PUT', '/api/providers/config', {
      ado: { orgUrl: 'https://dev.azure.com/org', token: 'ado-token' },
    });
  });

  it('propagates provider validation failures as CocApiError instances', async () => {
    mock = await startMockServer();
    mock.on('PUT', '/api/providers/config', {
      status: 400,
      statusText: 'Bad Request',
      body: { error: 'ado.orgUrl must be a non-empty string' },
    });
    const client = createClient(mock);

    await expect(client.pullRequests.saveProviderConfig({
      ado: { orgUrl: '', token: 'ado-token' },
    })).rejects.toMatchObject({
      name: 'CocApiError',
      status: 400,
      statusText: 'Bad Request',
      message: 'ado.orgUrl must be a non-empty string',
      body: { error: 'ado.orgUrl must be a non-empty string' },
    } satisfies Partial<CocApiError>);
  });
});

function createClient(mock: MockServer): CocClient {
  return new CocClient({ baseUrl: mock.url, fetch: globalThis.fetch });
}

function expectEmptyRequest(
  request: RecordedRequest,
  method: string,
  path: string,
): void {
  expect(request).toMatchObject({
    method,
    path,
    query: {},
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
): void {
  expect(request).toMatchObject({
    method,
    path,
    query: {},
    rawBody: JSON.stringify(body),
    body,
  });
  expect(request.headers['content-type']).toBe('application/json');
}
