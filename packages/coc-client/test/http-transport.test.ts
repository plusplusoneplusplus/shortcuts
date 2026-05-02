import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CocApiError,
  CocNetworkError,
  HttpTransport,
  normalizeOptions,
  type CocClientOptions,
} from '../src';
import { startMockServer, type MockServer } from './mock-server';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

function createTransport(options: CocClientOptions): HttpTransport {
  return new HttpTransport(normalizeOptions(options));
}

function createNeverSettlingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    if (init?.signal?.aborted) {
      reject(init.signal.reason);
      return;
    }
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  }));
}

async function captureNetworkError(promise: Promise<unknown>): Promise<CocNetworkError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CocNetworkError);
    return error as CocNetworkError;
  }
  throw new Error('Expected request to fail');
}

describe('HTTP transport option normalization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws a network error when no fetch implementation is available', () => {
    vi.stubGlobal('fetch', undefined);

    expect(() => normalizeOptions({ fetch: undefined })).toThrow(CocNetworkError);
    try {
      normalizeOptions({ fetch: undefined });
    } catch (error) {
      expect(error).toMatchObject({
        name: 'CocNetworkError',
        code: 'NETWORK_ERROR',
      } satisfies Partial<CocNetworkError>);
    }
  });

  it('applies defaults, normalizes URLs, and preserves default headers by reference', () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true })) as unknown as typeof fetch;
    const WebSocketCtor = vi.fn() as unknown as typeof WebSocket;
    const EventSourceCtor = vi.fn() as unknown as typeof EventSource;
    const defaultHeaders = { authorization: 'Bearer test-token' };
    vi.stubGlobal('WebSocket', WebSocketCtor);
    vi.stubGlobal('EventSource', EventSourceCtor);

    const normalized = normalizeOptions({
      baseUrl: 'http://localhost:4000///',
      apiBasePath: 'custom/api///',
      fetch: fetchImpl,
      defaultHeaders,
    });

    expect(normalized).toMatchObject({
      baseUrl: 'http://localhost:4000',
      apiBasePath: '/custom/api',
      wsPath: '/ws',
      WebSocket: WebSocketCtor,
      EventSource: EventSourceCtor,
    });
    expect(normalized.defaultHeaders).toBe(defaultHeaders);
  });
});

describe('HTTP transport request construction', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('infers GET, POST for body/rawBody, and preserves explicit methods', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/infer', { body: { ok: true } });
    mock.on('POST', '/api/infer', { body: { ok: true } });
    mock.on('PATCH', '/api/infer', { body: { ok: true } });
    const transport = createTransport({ baseUrl: mock.url, fetch: globalThis.fetch });

    await transport.request('/infer');
    await transport.request('/infer', { body: { value: 1 } });
    await transport.request('/infer', { rawBody: 'raw text' });
    await transport.request('/infer', { method: 'PATCH', body: { value: 2 } });

    expect(mock.requests.map(request => request.method)).toEqual(['GET', 'POST', 'POST', 'PATCH']);
  });

  it('sets JSON content-type only when absent and preserves raw body content-type', async () => {
    mock = await startMockServer();
    mock.on('POST', '/api/body', { body: { ok: true } });
    const transport = createTransport({ baseUrl: mock.url, fetch: globalThis.fetch });

    await transport.request('/body', { body: { value: 1 } });
    await transport.request('/body', {
      body: { value: 2 },
      headers: { 'content-type': 'application/vnd.custom+json' },
    });
    await transport.request('/body', {
      rawBody: 'plain text',
      headers: { 'content-type': 'text/plain' },
    });

    expect(mock.requests[0].headers['content-type']).toBe('application/json');
    expect(mock.requests[0].body).toEqual({ value: 1 });
    expect(mock.requests[1].headers['content-type']).toBe('application/vnd.custom+json');
    expect(mock.requests[1].rawBody).toBe(JSON.stringify({ value: 2 }));
    expect(mock.requests[2].headers['content-type']).toBe('text/plain');
    expect(mock.requests[2].rawBody).toBe('plain text');
  });

  it('passes raw string, Buffer, and FormData bodies through without re-stringifying', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const transport = createTransport({ fetch: fetchMock as unknown as typeof fetch });
    const buffer = Buffer.from('buffer body');
    const formData = new FormData();
    formData.append('name', 'value');

    await transport.request('/raw-string', { rawBody: 'raw string' });
    await transport.request('/raw-buffer', { rawBody: buffer as unknown as BodyInit });
    await transport.request('/raw-form', { rawBody: formData });

    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe('raw string');
    expect((fetchMock.mock.calls[1][1] as RequestInit).body).toBe(buffer);
    expect((fetchMock.mock.calls[2][1] as RequestInit).body).toBe(formData);
  });

  it('merges default and request headers from objects, Headers, and tuple arrays', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/headers', { body: { ok: true } });
    const transport = createTransport({
      baseUrl: mock.url,
      fetch: globalThis.fetch,
      defaultHeaders: {
        'x-default': 'default',
        'x-shared': 'default',
      },
    });

    await transport.request('/headers', {
      headers: {
        'x-shared': 'object-request',
        'x-object': 'object',
      },
    });
    await transport.request('/headers', {
      headers: new Headers([
        ['x-shared', 'headers-request'],
        ['x-headers', 'headers'],
      ]),
    });
    await transport.request('/headers', {
      headers: [
        ['x-shared', 'array-request'],
        ['x-array', 'array'],
      ],
    });

    expect(mock.requests[0].headers).toMatchObject({
      'x-default': 'default',
      'x-shared': 'object-request',
      'x-object': 'object',
    });
    expect(mock.requests[1].headers).toMatchObject({
      'x-default': 'default',
      'x-shared': 'headers-request',
      'x-headers': 'headers',
    });
    expect(mock.requests[2].headers).toMatchObject({
      'x-default': 'default',
      'x-shared': 'array-request',
      'x-array': 'array',
    });
  });
});

describe('HTTP transport response parsing and errors', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
    vi.restoreAllMocks();
  });

  it('parses no-content, JSON, JSON-looking text, and plain text responses', async () => {
    mock = await startMockServer();
    mock.on('DELETE', '/api/item', { noContent: true });
    mock.on('GET', '/api/json', { body: { value: 1 } });
    mock.on('GET', '/api/json-text', { rawBody: '{"value":2}' });
    mock.on('GET', '/api/plain-text', { rawBody: 'plain text' });
    const transport = createTransport({ baseUrl: mock.url, fetch: globalThis.fetch });

    await expect(transport.request('/item', { method: 'DELETE' })).resolves.toBeUndefined();
    await expect(transport.request('/json')).resolves.toEqual({ value: 1 });
    await expect(transport.request('/json-text')).resolves.toEqual({ value: 2 });
    await expect(transport.request('/plain-text')).resolves.toBe('plain text');
  });

  it('rejects fetch results that are not Response-like', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      json: async () => ({ ok: true }),
    });
    const transport = createTransport({ fetch: fetchMock as unknown as typeof fetch });

    await expect(transport.request('/invalid-response')).rejects.toMatchObject({
      name: 'CocNetworkError',
      code: 'NETWORK_ERROR',
    } satisfies Partial<CocNetworkError>);
  });

  it('maps JSON API error envelopes to CocApiError fields', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/missing', {
      status: 404,
      body: {
        error: 'Process not found',
        code: 'NOT_FOUND',
        details: { id: 'p1' },
      },
    });
    const transport = createTransport({ baseUrl: mock.url, fetch: globalThis.fetch });

    await expect(transport.request('/missing')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
      message: 'Process not found',
      code: 'NOT_FOUND',
      details: { id: 'p1' },
    } satisfies Partial<CocApiError>);
  });

  it('maps non-JSON API failures to CocApiError messages with text bodies', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/text-error', {
      status: 502,
      headers: { 'content-type': 'text/plain' },
      rawBody: 'upstream failed',
    });
    const transport = createTransport({ baseUrl: mock.url, fetch: globalThis.fetch });

    await expect(transport.request('/text-error')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 502,
      message: 'upstream failed',
      body: 'upstream failed',
    } satisfies Partial<CocApiError>);
  });

  it('wraps socket-level failures as network errors with a cause', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/drop', { destroySocket: true });
    const transport = createTransport({ baseUrl: mock.url, fetch: globalThis.fetch });

    const error = await captureNetworkError(transport.request('/drop'));
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.cause).toBeDefined();
  });
});

describe('HTTP transport timeout and abort composition', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('uses request timeout overrides and includes the timeout in the error message', async () => {
    vi.useFakeTimers();
    const fetchMock = createNeverSettlingFetch();
    const transport = createTransport({
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 1_000,
    });

    const request = transport.request('/slow', { timeoutMs: 25 });
    const assertion = expect(request).rejects.toMatchObject({
      name: 'CocNetworkError',
      code: 'TIMEOUT',
      message: 'CoC API request timed out after 25ms',
    } satisfies Partial<CocNetworkError>);
    await vi.advanceTimersByTimeAsync(25);

    await assertion;
  });

  it('times out slow mock-server responses', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/slow', { delayMs: 100, body: { ok: true } });
    const transport = createTransport({
      baseUrl: mock.url,
      fetch: globalThis.fetch,
      timeoutMs: 10,
    });

    await expect(transport.request('/slow')).rejects.toMatchObject({
      name: 'CocNetworkError',
      code: 'TIMEOUT',
      message: 'CoC API request timed out after 10ms',
    } satisfies Partial<CocNetworkError>);
  });

  it('maps an already-aborted caller signal to an aborted network error', async () => {
    const reason = new Error('already aborted');
    const controller = new AbortController();
    controller.abort(reason);
    const fetchMock = createNeverSettlingFetch();
    const transport = createTransport({ fetch: fetchMock as unknown as typeof fetch });

    const error = await captureNetworkError(transport.request('/aborted', { signal: controller.signal }));

    expect(error.code).toBe('ABORTED');
    expect(error.cause).toBe(reason);
  });

  it('maps caller aborts during a request and preserves the abort reason as cause', async () => {
    const reason = new Error('caller aborted');
    const controller = new AbortController();
    const fetchMock = createNeverSettlingFetch();
    const transport = createTransport({ fetch: fetchMock as unknown as typeof fetch });

    const request = transport.request('/aborted', { signal: controller.signal });
    controller.abort(reason);
    const error = await captureNetworkError(request);

    expect(error.code).toBe('ABORTED');
    expect(error.cause).toBe(reason);
  });

  it('lets caller abort win when it fires before a composed timeout', async () => {
    vi.useFakeTimers();
    const reason = new Error('caller first');
    const controller = new AbortController();
    const fetchMock = createNeverSettlingFetch();
    const transport = createTransport({ fetch: fetchMock as unknown as typeof fetch });

    const request = transport.request('/race', { signal: controller.signal, timeoutMs: 100 });
    controller.abort(reason);
    const error = await captureNetworkError(request);

    expect(error.code).toBe('ABORTED');
    expect(error.cause).toBe(reason);
  });

  it('lets timeout win when it fires before caller abort', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = createNeverSettlingFetch();
    const transport = createTransport({ fetch: fetchMock as unknown as typeof fetch });

    const request = transport.request('/race', { signal: controller.signal, timeoutMs: 30 });
    const errorPromise = captureNetworkError(request);
    await vi.advanceTimersByTimeAsync(30);
    const error = await errorPromise;
    controller.abort(new Error('too late'));

    expect(error.code).toBe('TIMEOUT');
    expect(error.message).toContain('30ms');
  });

  it('clears timeout timers after successful responses', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const transport = createTransport({
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 1_000,
    });

    await expect(transport.request('/ok')).resolves.toEqual({ ok: true });

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
