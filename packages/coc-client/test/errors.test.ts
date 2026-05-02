import { afterEach, describe, expect, it } from 'vitest';
import { CocApiError, CocNetworkError } from '../src';
import { createApiError } from '../src/errors';
import { startMockServer, type MockResponse, type MockServer } from './mock-server';

describe('client errors', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  async function createErrorFromMock(path: string, response: MockResponse): Promise<CocApiError> {
    mock = await startMockServer();
    mock.on('GET', path, response);
    const url = `${mock.url}${path}`;
    const apiResponse = await fetch(url);
    return createApiError(apiResponse, url);
  }

  it('exposes structured API error fields', () => {
    const error = new CocApiError({
      status: 404,
      statusText: 'Not Found',
      url: 'http://localhost/api/missing',
      message: 'Missing',
      code: 'NOT_FOUND',
      details: { id: 'x' },
    });

    expect(error.message).toBe('Missing');
    expect(error.status).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.details).toEqual({ id: 'x' });
  });

  it('parses nested JSON API error envelopes', async () => {
    const error = await createErrorFromMock('/api/nested-error', {
      status: 409,
      body: {
        error: {
          code: 'CONFLICT',
          message: 'Process already exists',
          details: { id: 'p1' },
        },
      },
    });

    expect(error).toMatchObject({
      status: 409,
      statusText: 'Conflict',
      message: 'Process already exists',
      code: 'CONFLICT',
      details: { id: 'p1' },
      body: {
        error: {
          code: 'CONFLICT',
          message: 'Process already exists',
          details: { id: 'p1' },
        },
      },
    } satisfies Partial<CocApiError>);
  });

  it('parses flat JSON API errors', async () => {
    const error = await createErrorFromMock('/api/flat-error', {
      status: 403,
      body: {
        code: 'FORBIDDEN',
        message: 'Access denied',
        details: { scope: 'repo' },
      },
    });

    expect(error).toMatchObject({
      status: 403,
      statusText: 'Forbidden',
      message: 'Access denied',
      code: 'FORBIDDEN',
      details: { scope: 'repo' },
    } satisfies Partial<CocApiError>);
  });

  it('falls back to status text for unrecognized JSON errors', async () => {
    const error = await createErrorFromMock('/api/unrecognized-json-error', {
      status: 500,
      body: { reason: 'unknown' },
    });

    expect(error).toMatchObject({
      status: 500,
      statusText: 'Internal Server Error',
      message: 'Internal Server Error',
      body: { reason: 'unknown' },
    } satisfies Partial<CocApiError>);
  });

  it('uses plain text error bodies as the message', async () => {
    const error = await createErrorFromMock('/api/plain-text-error', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
      rawBody: 'maintenance window',
    });

    expect(error).toMatchObject({
      status: 503,
      statusText: 'Service Unavailable',
      message: 'maintenance window',
      body: 'maintenance window',
    } satisfies Partial<CocApiError>);
  });

  it('synthesizes a message for empty non-2xx bodies', async () => {
    const error = await createErrorFromMock('/api/empty-error', {
      status: 404,
    });

    expect(error).toMatchObject({
      status: 404,
      statusText: 'Not Found',
      message: 'CoC API request failed: 404 Not Found',
      body: '',
    } satisfies Partial<CocApiError>);
  });

  it('falls back to raw text for malformed JSON error bodies', async () => {
    const error = await createErrorFromMock('/api/malformed-json-error', {
      status: 500,
      headers: { 'content-type': 'application/json' },
      rawBody: '{"message":',
    });

    expect(error).toMatchObject({
      status: 500,
      statusText: 'Internal Server Error',
      message: '{"message":',
      body: '{"message":',
    } satisfies Partial<CocApiError>);
  });

  it.each([401, 403, 404, 409, 429, 500, 503])('preserves HTTP status %i on API errors', async status => {
    const error = await createErrorFromMock(`/api/status-${status}`, {
      status,
      body: { message: `failed with ${status}` },
    });

    expect(error.status).toBe(status);
  });

  it.skip('TODO exposes numeric Retry-After metadata on 429 and 503 API errors', async () => {
    // Retry-After is not currently represented on CocApiError.
  });

  it.skip('TODO exposes HTTP-date Retry-After metadata on 429 and 503 API errors', async () => {
    // Retry-After is not currently represented on CocApiError.
  });

  it.each(['NETWORK_ERROR', 'TIMEOUT', 'ABORTED'] as const)('exposes %s network failure details', code => {
    const cause = new Error(`${code} cause`);
    const error = new CocNetworkError('failed', { url: '/api/health', code, cause });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CocNetworkError);
    expect(error.url).toBe('/api/health');
    expect(error.code).toBe(code);
    expect(error.cause).toBe(cause);
  });

  it('preserves the default network error code and url', () => {
    const error = new CocNetworkError('failed', { url: '/api/health' });

    expect(error.url).toBe('/api/health');
    expect(error.code).toBe('NETWORK_ERROR');
  });

  it('keeps CocApiError identity and serializes structured fields', () => {
    const error = new CocApiError({
      status: 429,
      statusText: 'Too Many Requests',
      url: 'http://127.0.0.1/api/rate-limited',
      message: 'Slow down',
      code: 'RATE_LIMITED',
      details: { retryable: true },
      body: { error: { message: 'Slow down' } },
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CocApiError);
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: 'CocApiError',
      message: 'Slow down',
      status: 429,
      statusText: 'Too Many Requests',
      url: 'http://127.0.0.1/api/rate-limited',
      code: 'RATE_LIMITED',
      details: { retryable: true },
      body: { error: { message: 'Slow down' } },
    });
  });

  it('includes code and status in CocApiError string output', () => {
    const error = new CocApiError({
      status: 404,
      statusText: 'Not Found',
      url: 'http://127.0.0.1/api/missing',
      message: 'Missing',
      code: 'NOT_FOUND',
    });

    expect(error.toString()).toContain('NOT_FOUND');
    expect(error.toString()).toContain('404');
  });
});
