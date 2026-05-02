import { describe, expect, it, vi } from 'vitest';
import { CocApiError, CocNetworkError, CocClient } from '../src';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

describe('HTTP transport', () => {
  it('builds GET request URLs with query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = new CocClient({ baseUrl: 'http://localhost:4000', fetch: fetchMock as typeof fetch });

    await client.request('/health', { query: { a: 1, empty: undefined } });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4000/api/health?a=1', expect.objectContaining({ method: 'GET' }));
  });

  it('serializes JSON bodies once and sets content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = new CocClient({ baseUrl: 'http://localhost:4000', fetch: fetchMock as typeof fetch });
    const body = { title: 'Task' };

    await client.request('/workspaces/ws/work-items', { method: 'POST', body });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(JSON.stringify(body));
    expect((init.headers as Headers).get('content-type')).toBe('application/json');
    expect(body).toEqual({ title: 'Task' });
  });

  it('returns undefined for 204 responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new CocClient({ fetch: fetchMock as typeof fetch });

    await expect(client.request('/processes/id', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('throws CocApiError for JSON API failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      { error: 'Process not found', code: 'NOT_FOUND', details: { id: 'p1' } },
      { status: 404, statusText: 'Not Found' },
    ));
    const client = new CocClient({ fetch: fetchMock as typeof fetch });

    await expect(client.request('/processes/p1')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 404,
      message: 'Process not found',
      code: 'NOT_FOUND',
      details: { id: 'p1' },
    } satisfies Partial<CocApiError>);
  });

  it('includes a text preview for non-JSON API failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('plain failure body', {
      status: 500,
      statusText: 'Server Error',
      headers: { 'content-type': 'text/plain' },
    }));
    const client = new CocClient({ fetch: fetchMock as typeof fetch });

    await expect(client.request('/health')).rejects.toMatchObject({
      name: 'CocApiError',
      status: 500,
      body: 'plain failure body',
    });
  });

  it('wraps network failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    const client = new CocClient({ fetch: fetchMock as typeof fetch });

    await expect(client.request('/health')).rejects.toMatchObject({
      name: 'CocNetworkError',
      code: 'NETWORK_ERROR',
    } satisfies Partial<CocNetworkError>);
  });

  it('times out requests', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));
    const client = new CocClient({ fetch: fetchMock as typeof fetch, timeoutMs: 1 });

    await expect(client.request('/health')).rejects.toMatchObject({
      name: 'CocNetworkError',
      code: 'TIMEOUT',
    });
  });

  it('respects caller abort signals', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      controller.abort(new Error('caller abort'));
    }));
    const client = new CocClient({ fetch: fetchMock as typeof fetch });

    await expect(client.request('/health', { signal: controller.signal })).rejects.toMatchObject({
      name: 'CocNetworkError',
      code: 'ABORTED',
    });
  });
});
